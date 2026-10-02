import { prisma, type Tx } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { computeLine } from "@/lib/order-calc";
import { autoPrintKitchenChange } from "@/server/hardware/printers";
import { assertOpen, getOrder, lockOrder, recalcOrder, resolveModifiers, type Actor } from "./orders";
import { onTicketNotReady } from "./service-tracking";
import type { KitchenTicketStatus, OrderItemStatus } from "@/generated/prisma/client";

/**
 * Circuit salle → cuisine pour un plat déjà envoyé :
 * - une modification (options retirées ❌, ajoutées ➕, note) ou une annulation arrive en cuisine comme telle,
 *   « urgente » si le plat était déjà en préparation ou prêt (la salle a confirmé en connaissance de cause) ;
 * - la cuisine la marque « vue » puis « appliquée » : la salle sait qu'elle a été reçue ;
 * - l'ancienne version reste dans l'historique, la caisse voit le nouveau prix.
 */

export type DishStage = "NEW" | "ACCEPTED" | "PREPARING" | "READY" | "SERVED";
export const STAGE_LABEL: Record<DishStage, string> = { NEW: "Nouvelle", ACCEPTED: "Acceptée", PREPARING: "En préparation", READY: "Prête", SERVED: "Servie" };

/** Où en est un plat envoyé, d'après son statut et celui de son bon cuisine */
export function dishStage(itemStatus: OrderItemStatus, ticketStatus: KitchenTicketStatus | null | undefined): DishStage | null {
  if (itemStatus === "PENDING" || itemStatus === "VOIDED") return null;
  if (itemStatus === "SERVED") return "SERVED";
  if (itemStatus === "READY") return "READY";
  if (itemStatus === "PREPARING" || ticketStatus === "IN_PROGRESS") return "PREPARING";
  if (ticketStatus === "READY") return "READY";
  if (ticketStatus === "DONE") return "SERVED";
  return ticketStatus === "ACCEPTED" ? "ACCEPTED" : "NEW";
}
const URGENT_STAGES: DishStage[] = ["PREPARING", "READY"];

async function who(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { firstName: true, displayName: true } });
  return u?.displayName?.trim() || u?.firstName || null;
}

/** Modifie les options et la note d'un plat ; s'il est déjà envoyé, la cuisine reçoit la modification. */
export async function modifyItem(actor: Actor, orderId: string, itemId: string, input: { modifiers: { modifierId: string; quantity?: number }[]; note?: string | null }) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  const item = order.items.find((i) => i.id === itemId);
  if (!item || item.status === "VOIDED") throw new ApiError(404, "NOT_FOUND", "Article introuvable");
  if (!item.productId) throw new ApiError(400, "NOT_MODIFIABLE", "Pour une formule, modifiez chacun de ses plats");
  const ticket = item.kitchenTicketId ? await prisma.kitchenTicket.findUnique({ where: { id: item.kitchenTicketId }, select: { id: true, status: true, stationId: true } }) : null;
  const stage = dishStage(item.status, ticket?.status);
  if (stage === "SERVED") throw new ApiError(409, "ALREADY_SERVED", "Plat déjà servi : annulez-le ou ajoutez un nouveau plat");
  const requestedByName = await who(actor.userId);
  let changeId: string | null = null;
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const mods = await resolveModifiers(tx, item.productId!, input.modifiers);
    const before = item.modifiers.map((m) => m.name);
    const after = mods.map((m) => m.name);
    const removed = before.filter((n) => !after.includes(n));
    const added = after.filter((n) => !before.includes(n));
    const note = input.note === undefined ? item.notes : input.note?.trim() || null;
    if (!removed.length && !added.length && note === item.notes) throw new ApiError(400, "NO_CHANGE", "Aucune modification");
    await tx.orderItemModifier.deleteMany({ where: { orderItemId: item.id } });
    if (mods.length) await tx.orderItemModifier.createMany({ data: mods.map((m) => ({ orderItemId: item.id, modifierId: m.modifierId, groupName: m.groupName, name: m.name, priceDelta: m.priceDelta, quantity: m.quantity })) });
    const modifiersTotal = mods.reduce((a, m) => a + m.priceDelta * m.quantity, 0);
    const calc = computeLine({ quantity: item.quantity, unitPrice: item.unitPrice, modifiersTotal, discountAmount: item.discountAmount, taxRateBps: item.taxRateBps });
    // Un plat déjà prêt à refaire repart en préparation : la salle ne doit pas l'emporter tel quel
    const backToKitchen = stage === "READY";
    await tx.orderItem.update({ where: { id: item.id }, data: { modifiersTotal, lineTotal: calc.lineTotal, taxAmount: calc.taxAmount, notes: note, ...(backToKitchen ? { status: "PREPARING", readyAt: null } : {}) } });
    if (backToKitchen && ticket && ticket.status === "READY") {
      await tx.kitchenTicket.update({ where: { id: ticket.id }, data: { status: "IN_PROGRESS", readyAt: null } });
      await onTicketNotReady(tx, orderId, ticket.id);
    }
    if (stage) {
      const change = await tx.kitchenChange.create({
        data: {
          establishmentId: actor.establishmentId, orderId, orderItemId: item.id, ticketId: ticket?.id ?? null, stationId: ticket?.stationId ?? item.kitchenStationId, kind: "MODIFY",
          urgent: URGENT_STAGES.includes(stage), stage, itemName: item.name, quantity: item.quantity, tableName: order.table?.name ?? null, orderNumber: order.number,
          removed, added, note: note !== item.notes ? note : null, requestedById: actor.userId, requestedByName,
        },
      });
      changeId = change.id;
    }
    await recalcOrder(tx, orderId);
    await audit({ ...actor, action: "item.modify", entityType: "order_item", entityId: item.id, oldValue: { modifiers: before, notes: item.notes, lineTotal: item.lineTotal }, newValue: { modifiers: after, notes: note, stage, orderNumber: order.number } }, tx);
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  if (changeId) {
    publish("kitchen.updated", actor.establishmentId, { orderId, changeId });
    autoPrintKitchenChange(actor.establishmentId, changeId).catch(() => {});
  }
  return getOrder(actor.establishmentId, orderId);
}

/** Annulation d'un plat envoyé : enregistrée pour la cuisine (appelée dans la transaction de l'annulation). */
export async function recordCancellation(tx: Tx, actor: Actor, order: { id: string; number: string; table: { name: string } | null }, item: { id: string; name: string; quantity: number; status: OrderItemStatus; kitchenTicketId: string | null; kitchenStationId: string | null }, reason: string | null) {
  const ticket = item.kitchenTicketId ? await tx.kitchenTicket.findUnique({ where: { id: item.kitchenTicketId }, select: { id: true, status: true, stationId: true } }) : null;
  const stage = dishStage(item.status, ticket?.status);
  if (!stage || stage === "SERVED") return null;
  const change = await tx.kitchenChange.create({
    data: {
      establishmentId: actor.establishmentId, orderId: order.id, orderItemId: item.id, ticketId: ticket?.id ?? null, stationId: ticket?.stationId ?? item.kitchenStationId, kind: "CANCEL",
      urgent: URGENT_STAGES.includes(stage), stage, itemName: item.name, quantity: item.quantity, tableName: order.table?.name ?? null, orderNumber: order.number,
      reason, requestedById: actor.userId, requestedByName: await who(actor.userId),
    },
  });
  return change.id;
}

const changeSelect = {
  id: true, orderId: true, orderItemId: true, ticketId: true, stationId: true, kind: true, urgent: true, stage: true, itemName: true, quantity: true, tableName: true, orderNumber: true,
  removed: true, added: true, note: true, reason: true, status: true, requestedByName: true, createdAt: true, seenAt: true, appliedAt: true,
} as const;

/** Écran cuisine : changements à traiter, et ceux appliqués dans les 10 dernières minutes */
export async function listKitchenChanges(establishmentId: string, stationId?: string | null) {
  return prisma.kitchenChange.findMany({
    where: {
      establishmentId, createdAt: { gte: new Date(Date.now() - 12 * 3600_000) },
      ...(stationId ? { OR: [{ stationId }, { stationId: null }] } : {}),
      OR: [{ status: { in: ["REQUESTED", "SEEN"] } }, { appliedAt: { gte: new Date(Date.now() - 10 * 60_000) } }],
    },
    orderBy: [{ urgent: "desc" }, { createdAt: "asc" }],
    select: changeSelect,
  });
}

/** Salle : où en est chaque plat de la commande et l'historique de ses modifications */
export async function orderKitchenState(establishmentId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, establishmentId }, select: { items: { select: { id: true, status: true, kitchenTicket: { select: { status: true } } } } } });
  if (!order) throw new ApiError(404, "NOT_FOUND", "Commande introuvable");
  const changes = await prisma.kitchenChange.findMany({ where: { orderId }, orderBy: { createdAt: "desc" }, select: changeSelect });
  return { stages: Object.fromEntries(order.items.map((i) => [i.id, dishStage(i.status, i.kitchenTicket?.status)])), changes };
}

/** Cuisine : « vue » puis « appliquée » (une annulation vue est appliquée d'office) */
export async function setChangeStatus(actor: Actor, id: string, status: "SEEN" | "APPLIED") {
  const c = await prisma.kitchenChange.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!c) throw new ApiError(404, "NOT_FOUND", "Modification introuvable");
  if (c.status === "APPLIED") return c;
  const now = new Date();
  const next = status === "SEEN" && c.kind === "CANCEL" ? "APPLIED" : status;
  const updated = await prisma.kitchenChange.update({ where: { id }, data: { status: next, seenAt: c.seenAt ?? now, ...(next === "APPLIED" ? { appliedAt: now } : {}) } });
  await audit({ ...actor, action: "kitchen.change", entityType: "kitchen_change", entityId: id, oldValue: { status: c.status }, newValue: { status: next, kind: c.kind, item: c.itemName, orderNumber: c.orderNumber } });
  publish("kitchen.updated", actor.establishmentId, { orderId: c.orderId, changeId: id });
  publish("order.updated", actor.establishmentId, { orderId: c.orderId });
  return updated;
}
