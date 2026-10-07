import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { startOfLocalDay, localDay, addDays } from "@/lib/dates";
import { isEmailConfigured, readyMail, sendMail } from "@/server/email/mailer";
import type { OrderType, Prisma } from "@/generated/prisma/client";
import type { Actor } from "./orders";

/*
 * Vente à emporter : une seule file pour le comptoir, les commandes à emporter, en ligne (retrait et livraison)
 * et la borne. Chaque commande passe de « en préparation » à « prête » (le numéro est appelé) puis « remise ».
 * « Prête » vient de la cuisine (tous les plats prêts) ou d'un geste en caisse.
 */

const appUrl = () => process.env.PUBLIC_URL?.replace(/\/$/, "") || "https://app.manaresto.com";

export const TAKEAWAY_TYPES: OrderType[] = ["COUNTER", "TAKEAWAY", "ONLINE", "DELIVERY", "KIOSK"];

export type TakeawayStage = "to_accept" | "preparing" | "ready";

/** Numéro d'appel lisible : « 20261002-0042 » → « 42 ». */
export const callNumber = (number: string) => String(Number(number.split("-")[1] ?? number) || number);

const boardSelect = {
  id: true, number: true, type: true, status: true, isTab: true, customerName: true, tableLabel: true, table: { select: { name: true } }, customerPhone: true, pickupAt: true, readyAt: true, pickedUpAt: true,
  openedAt: true, acceptedAt: true, closedAt: true, total: true, paidTotal: true, channelMeta: true,
  items: { where: { status: { not: "VOIDED" as const }, parentItemId: null }, select: { quantity: true, status: true, name: true } },
} satisfies Prisma.OrderSelect;

type Row = Prisma.OrderGetPayload<{ select: typeof boardSelect }>;

function cardOf(o: Row) {
  const meta = (o.channelMeta ?? {}) as Record<string, unknown>;
  const sent = o.items.filter((i) => i.status !== "PENDING");
  const ready = sent.filter((i) => i.status === "READY" || i.status === "SERVED");
  const kitchenDone = sent.length > 0 && ready.length === sent.length && sent.length === o.items.length;
  const awaiting = !o.acceptedAt && meta.awaitingAcceptance === true;
  const paid = o.status === "PAID" || (o.total > 0 && o.paidTotal >= o.total);
  const stage: TakeawayStage = awaiting ? "to_accept" : o.readyAt || kitchenDone ? "ready" : "preparing";
  const channel = o.type === "ONLINE" ? "PICKUP" : o.type;
  return {
    id: o.id, number: o.number, call: callNumber(o.number), type: o.type, channel, stage, paid, total: o.total,
    name: o.customerName ?? (typeof meta.name === "string" ? meta.name : null),
    // Mode roulotte : numéro ou repère de table où apporter les plats
    tableLabel: o.tableLabel ?? o.table?.name ?? null,
    isTab: o.isTab, // ardoise du bar : servie au comptoir du bar, pas une table de la salle
    itemNames: o.items.map((i) => `${i.quantity > 1 ? `${i.quantity} × ` : ""}${i.name}`),
    phone: o.customerPhone ?? (typeof meta.phone === "string" ? meta.phone : null),
    when: typeof meta.when === "string" ? meta.when : null,
    address: typeof meta.address === "string" ? meta.address : null,
    pickupAt: o.pickupAt?.toISOString() ?? null, readyAt: o.readyAt?.toISOString() ?? null, openedAt: o.openedAt.toISOString(),
    items: o.items.reduce((a, i) => a + i.quantity, 0), itemsReady: ready.reduce((a, i) => a + i.quantity, 0), itemsSent: sent.reduce((a, i) => a + i.quantity, 0),
  };
}

export type TakeawayCard = ReturnType<typeof cardOf>;

/** Commandes à emporter du jour, pas encore remises (les commandes vides ou annulées n'apparaissent pas). */
async function openTakeaway(establishmentId: string, timezone: string, now = new Date(), types: OrderType[] = TAKEAWAY_TYPES) {
  const today = localDay(now, timezone);
  const dayStart = startOfLocalDay(today, timezone);
  const dayEnd = startOfLocalDay(addDays(today, 1), timezone);
  const rows = await prisma.order.findMany({
    where: {
      establishmentId, type: { in: types }, status: { not: "CANCELLED" }, pickedUpAt: null,
      OR: [{ openedAt: { gte: dayStart } }, { pickupAt: { gte: dayStart, lt: dayEnd } }],
      items: { some: { status: { not: "VOIDED" } } },
    },
    select: boardSelect,
    orderBy: { openedAt: "asc" },
  });
  // Déjà remises sans passer par le bouton : payées et « terminées » en cuisine (plats servis), ou payées depuis plus de 3 h
  const handedOver = (o: Row) => o.status === "PAID" && (o.items.every((i) => i.status === "SERVED") || (!!o.closedAt && now.getTime() - o.closedAt.getTime() > 3 * 3600_000));
  // Commande sans heure de retrait : à servir dès que possible (triée par arrivée) ; sinon par heure de retrait
  return rows.filter((o) => !handedOver(o)).map(cardOf).sort((a, b) => (a.pickupAt ?? a.openedAt).localeCompare(b.pickupAt ?? b.openedAt));
}

/** Mode roulotte (settings.payAtOrder) : les commandes à table, payées d'abord, suivent aussi la file (portail Salle). */
async function roulotteTypes(establishmentId: string, settings: unknown): Promise<OrderType[]> {
  void establishmentId;
  return ((settings ?? {}) as { payAtOrder?: boolean }).payAtOrder === true ? [...TAKEAWAY_TYPES, "DINE_IN"] : TAKEAWAY_TYPES;
}

/** Tableau « À emporter » de la caisse ; `withTables` (portail Salle, mode roulotte) : aussi les commandes à table en cuisine. */
export async function takeawayBoard(establishmentId: string, now = new Date(), opts: { withTables?: boolean } = {}) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true, settings: true } });
  const cards = await openTakeaway(establishmentId, est.timezone, now, opts.withTables ? await roulotteTypes(establishmentId, est.settings) : TAKEAWAY_TYPES);
  return {
    toAccept: cards.filter((c) => c.stage === "to_accept"),
    preparing: cards.filter((c) => c.stage === "preparing"),
    ready: cards.filter((c) => c.stage === "ready"),
  };
}

/** Écran d'appel (visible des clients) : uniquement les numéros, jamais les noms ni les téléphones. */
export async function callDisplay(establishmentId: string, now = new Date()) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true, name: true } });
  const cards = (await openTakeaway(establishmentId, est.timezone, now)).filter((c) => c.stage !== "to_accept" && c.channel !== "DELIVERY");
  return {
    establishment: est.name,
    preparing: cards.filter((c) => c.stage === "preparing").map((c) => c.call),
    ready: cards.filter((c) => c.stage === "ready").sort((a, b) => (b.readyAt ?? "").localeCompare(a.readyAt ?? "")).map((c) => ({ call: c.call, readyAt: c.readyAt })),
  };
}

/** Prête (le numéro s'affiche à l'écran d'appel, le client est prévenu s'il a laissé son e-mail), pas encore prête, ou remise. */
export async function setTakeawayStep(actor: Actor, orderId: string, step: "ready" | "not_ready" | "picked_up") {
  const order = await prisma.order.findFirst({ where: { id: orderId, establishmentId: actor.establishmentId }, select: { ...boardSelect, publicToken: true, establishment: { select: { name: true, phone: true, settings: true } } } });
  if (!order) throw new ApiError(404, "NOT_FOUND", "Commande introuvable");
  // Mode roulotte : « Servi » depuis le portail Salle vaut aussi pour une commande à table
  if (!(await roulotteTypes(actor.establishmentId, order.establishment.settings)).includes(order.type)) throw new ApiError(400, "NOT_TAKEAWAY", "Cette commande n'est pas à emporter");
  if (order.status === "CANCELLED") throw new ApiError(409, "CANCELLED", "Cette commande est annulée");
  const card = cardOf(order);
  if (step === "picked_up") {
    if (!card.paid) throw new ApiError(409, "NOT_PAID", "Encaissez la commande avant de la remettre au client");
    await prisma.order.update({ where: { id: orderId }, data: { pickedUpAt: new Date(), readyAt: order.readyAt ?? new Date() } });
  } else {
    if (card.stage === "to_accept") throw new ApiError(409, "NOT_ACCEPTED", "Acceptez d'abord la commande en ligne");
    await prisma.order.update({ where: { id: orderId }, data: { readyAt: step === "ready" ? (order.readyAt ?? new Date()) : null } });
  }
  await audit({ organizationId: actor.organizationId, establishmentId: actor.establishmentId, userId: actor.userId, action: `takeaway.${step}`, entityType: "order", entityId: orderId });
  publish("order.updated", actor.establishmentId, { orderId, tableId: null });
  if (step === "ready" && !order.readyAt) notifyReady(order, card);
  return { ok: true };
}

/** Client prévenu par e-mail (commande en ligne avec adresse) dès que sa commande est prête. */
function notifyReady(order: { type: OrderType; channelMeta: unknown; publicToken: string | null; establishment: { name: string; phone: string | null } }, card: TakeawayCard) {
  const meta = (order.channelMeta ?? {}) as Record<string, unknown>;
  if (typeof meta.email !== "string" || !meta.email || !isEmailConfigured()) return;
  const trackUrl = order.publicToken ? `${appUrl()}/suivi/${order.publicToken}` : null;
  void sendMail(readyMail({ to: meta.email, establishmentName: order.establishment.name, name: card.name ?? "", call: card.call, delivery: order.type === "DELIVERY", phone: order.establishment.phone, trackUrl }))
    .catch((e) => console.error("[à emporter] e-mail « prête » non envoyé", e));
}

/** Cuisine : tous les plats d'une commande à emporter sont prêts → la commande est prête (écran d'appel, client prévenu). */
export async function syncTakeawayReady(establishmentId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, establishmentId }, select: { ...boardSelect, publicToken: true, establishment: { select: { name: true, phone: true } } } });
  if (!order || order.readyAt || order.pickedUpAt || !TAKEAWAY_TYPES.includes(order.type) || order.status === "CANCELLED") return false;
  const card = cardOf(order);
  if (card.stage !== "ready") return false;
  await prisma.order.update({ where: { id: orderId }, data: { readyAt: new Date() } });
  publish("order.updated", establishmentId, { orderId, tableId: null });
  notifyReady(order, card);
  return true;
}
