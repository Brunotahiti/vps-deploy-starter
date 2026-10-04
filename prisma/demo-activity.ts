/**
 * Démo vivante : l'activité du restaurant de démonstration est générée jour par jour (de façon reproductible)
 * et le service du jour est renouvelé à chaque passage du rafraîchissement (toutes les heures sur le serveur).
 *  - historique : commandes payées sur place, à emporter, en ligne, livraison, borne ; pourboires, remises,
 *    annulations, remboursements ; sessions de caisse clôturées ; consommation de stock ; achats ; pointages ;
 *    réservations ; fidélité.
 *  - aujourd'hui : commandes déjà encaissées jusqu'à l'heure courante, tables en cours avec tickets cuisine,
 *    commandes en ligne à accepter, caisse ouverte, équipe pointée.
 * Les commandes générées portent channelMeta.demo = true : celles saisies par les visiteurs ne sont jamais
 * effacées, sauf si elles restent ouvertes d'un jour sur l'autre.
 */
import crypto from "node:crypto";
import type { OrderType, PaymentMethod, Prisma, PrismaClient } from "../src/generated/prisma/client";
import { computeLine, computeOrderTotals } from "../src/lib/order-calc";
import { addDays, localDay, startOfLocalDay } from "../src/lib/dates";
import { hygieneDemo } from "./demo-hygiene";
import { accountsDemo } from "./demo-accounts";
import { marketingDemo } from "./demo-marketing";
import { screensDemo } from "./demo-screens";
import { cateringDemo } from "./demo-catering";
import { barDemo } from "./demo-bar";
import { wineDemo } from "./demo-wine";

export const DEMO_SLUG = "demo-mana-beach";
const SERVER_EMAILS = ["moana@manaresto.pf", "vaiana@manaresto.pf", "tamatoa@manaresto.pf", "poema@manaresto.pf", "heimana@manaresto.pf"];
const COURSES = ["APÉRITIFS", "ENTRÉES", "PLATS", "DESSERTS"];
const HISTORY_DAYS = 60; // historique créé avec la démo
const KEEP_DAYS = 90; // au-delà, l'activité générée est supprimée
const LIVE_TABLES = [0, 3, 5, 14, 16]; // T01, T04, T06, T15, T17
const FIRST_FREE_NUMBER = 200; // numéros réservés aux commandes générées du jour ; les visiteurs prennent la suite

// ---------------------------------------------------------------- hasard reproductible par jour

function rngFor(key: string) {
  let h = 2166136261;
  for (const ch of key) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let s = h >>> 0;
  const next = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, pick: <T,>(a: T[]): T => a[Math.floor(next() * a.length)], between: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)), chance: (p: number) => next() < p };
}
type Rng = ReturnType<typeof rngFor>;

// ---------------------------------------------------------------- contexte

type Mod = { id: string; name: string; priceDelta: number; groupName: string };
type Group = { name: string; minSelect: number; mods: Mod[] };
type P = { id: string; name: string; priceTtc: number; costPrice: number; taxRateBps: number; taxRateName: string; stationId: string | null; groups: Group[] };

export type DemoCtx = {
  orgId: string; estId: string; tz: string; ownerId: string; managerId: string; servers: string[];
  employees: { id: string }[]; tables: { id: string }[]; customers: { id: string; name: string; phone: string | null }[];
  entrees: P[]; plats: P[]; desserts: P[]; boissons: P[]; vins: P[];
  recipes: Map<string, { ingredientId: string; quantity: number; avgCost: number }[]>;
  supplierProducts: { id: string; supplierId: string; ingredientId: string; packSize: number; lastPrice: number }[];
  pointsPer100: number; deliveryFee: number;
};

export async function loadDemoContext(prisma: PrismaClient): Promise<DemoCtx | null> {
  const org = await prisma.organization.findUnique({ where: { slug: DEMO_SLUG }, select: { id: true, establishments: { orderBy: { createdAt: "asc" }, take: 1, select: { id: true, timezone: true, settings: true } } } });
  const est = org?.establishments[0];
  if (!org || !est) return null;
  const users = await prisma.user.findMany({ where: { organizationId: org.id, isActive: true }, select: { id: true, email: true, isOwner: true } });
  const ownerId = users.find((u) => u.isOwner)?.id ?? users[0]?.id;
  if (!ownerId) return null;
  const managerId = users.find((u) => u.email === "manager@manaresto.pf")?.id ?? ownerId;
  const servers = SERVER_EMAILS.map((e) => users.find((u) => u.email === e)?.id).filter((x): x is string => !!x);
  const products = await prisma.product.findMany({
    where: { establishmentId: est.id, isActive: true },
    orderBy: { sortOrder: "asc" },
    include: { category: { select: { name: true } }, taxRate: { select: { rateBps: true, name: true } }, modifierGroups: { orderBy: { sortOrder: "asc" }, include: { modifierGroup: { include: { modifiers: { orderBy: { sortOrder: "asc" } } } } } }, recipeLines: { include: { ingredient: { select: { avgCost: true } } } } },
  });
  const toP = (p: (typeof products)[number]): P => ({
    id: p.id, name: p.name, priceTtc: p.priceTtc, costPrice: p.costPrice, taxRateBps: p.taxRate?.rateBps ?? 1300, taxRateName: p.taxRate?.name ?? "TVA", stationId: p.kitchenStationId,
    groups: p.modifierGroups.map((g) => ({ name: g.modifierGroup.name, minSelect: g.modifierGroup.minSelect, mods: g.modifierGroup.modifiers.map((m) => ({ id: m.id, name: m.name, priceDelta: m.priceDelta, groupName: g.modifierGroup.name })) })),
  });
  const inCat = (name: string) => products.filter((p) => p.category?.name === name).map(toP);
  const recipes = new Map(products.map((p) => [p.id, p.recipeLines.map((r) => ({ ingredientId: r.ingredientId, quantity: Number(r.quantity), avgCost: r.ingredient.avgCost }))]));
  const settings = (est.settings ?? {}) as { loyalty?: { pointsPer100?: number }; digital?: { online?: { deliveryFee?: number } } };
  const ctx: DemoCtx = {
    orgId: org.id, estId: est.id, tz: est.timezone, ownerId, managerId, servers: servers.length ? servers : [ownerId],
    employees: await prisma.employee.findMany({ where: { establishmentId: est.id, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }),
    tables: await prisma.table.findMany({ where: { establishmentId: est.id, isActive: true }, orderBy: { name: "asc" }, select: { id: true } }),
    customers: (await prisma.customer.findMany({ where: { organizationId: org.id }, orderBy: { createdAt: "asc" }, select: { id: true, firstName: true, lastName: true, phone: true } })).map((c) => ({ id: c.id, name: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim(), phone: c.phone })),
    entrees: inCat("Entrées"), plats: inCat("Plats"), desserts: inCat("Desserts"), boissons: inCat("Boissons"), vins: inCat("Vins"),
    recipes,
    supplierProducts: (await prisma.supplierProduct.findMany({ where: { supplier: { establishmentId: est.id }, ingredientId: { not: null } }, select: { id: true, supplierId: true, ingredientId: true, packSize: true, lastPrice: true } })).map((s) => ({ ...s, ingredientId: s.ingredientId!, packSize: Number(s.packSize) })),
    pointsPer100: settings.loyalty?.pointsPer100 ?? 1, deliveryFee: settings.digital?.online?.deliveryFee ?? 500,
  };
  if (!ctx.plats.length || !ctx.boissons.length || !ctx.tables.length) return null;
  return ctx;
}

// ---------------------------------------------------------------- plan d'une journée (pur, reproductible)

type PlanItem = { p: P; course: number; mods: Mod[]; seat: number; voidReason?: string };
type PlanOrder = {
  seq: number; type: OrderType; tableIdx: number | null; serverIdx: number; covers: number; openAt: Date; closeAt: Date;
  items: PlanItem[]; discount: number; discountReason?: string; cancelReason?: string; customerIdx: number | null;
  method: PaymentMethod; tipRate: number; split: boolean; refund?: { part: number; reason: string }; meta?: Record<string, unknown>;
};

const DISCOUNT_REASONS = ["Geste commercial", "Client fidèle", "Attente en cuisine", "Anniversaire"];
const VOID_REASONS = ["Erreur de saisie", "Le client a changé d'avis", "Plat non disponible"];
const CANCEL_REASONS = ["Clients partis avant la commande", "Table saisie en double", "Erreur de table"];
const REFUND_REASONS = ["Plat non conforme", "Erreur d'encaissement", "Cuisson ratée"];
const CHANNEL_NAMES = ["Heiarii", "Manutea", "Tiare", "Ludovic", "Kim", "Ranitea", "Steeve", "Mareva", "Teva", "Laura"];

function chooseItems(ctx: DemoCtx, r: Rng, covers: number, full: boolean): PlanItem[] {
  const out: PlanItem[] = [];
  const mods = (p: P) => p.groups.flatMap((g) => (g.minSelect > 0 || r.chance(0.3)) && g.mods.length ? [r.pick(g.mods)] : []);
  for (let c = 0; c < covers; c++) {
    if (full && ctx.entrees.length && r.chance(0.5)) { const p = r.pick(ctx.entrees); out.push({ p, course: 1, mods: mods(p), seat: c + 1 }); }
    const plat = r.pick(ctx.plats); out.push({ p: plat, course: full ? 2 : 0, mods: mods(plat), seat: c + 1 });
    if (full && ctx.desserts.length && r.chance(0.45)) { const p = r.pick(ctx.desserts); out.push({ p, course: 3, mods: [], seat: c + 1 }); }
    const b = r.pick(ctx.boissons); out.push({ p: b, course: 0, mods: [], seat: c + 1 });
    if (full && r.chance(0.3)) { const p = r.pick(ctx.boissons); out.push({ p, course: 0, mods: [], seat: c + 1 }); }
  }
  // Cave à vin : une table sur trois prend du vin (bouteille, verre ou carafe)
  if (full && ctx.vins.length && r.chance(0.35)) out.push({ p: r.pick(ctx.vins), course: 0, mods: [], seat: 1 });
  return out;
}

export function dayPlan(ctx: DemoCtx, day: string): PlanOrder[] {
  const r = rngFor(`${ctx.estId}:${day}`);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const at = (h: number, m: number) => new Date(startOfLocalDay(day, ctx.tz).getTime() + (h * 60 + m) * 60000);
  const plans: Omit<PlanOrder, "seq">[] = [];
  const method = (): PaymentMethod => { const x = r.next(); return x < 0.55 ? "CARD" : x < 0.85 ? "CASH" : x < 0.93 ? "MEAL_VOUCHER" : x < 0.97 ? "TRANSFER" : "CHECK"; };
  const customer = (p: number) => (ctx.customers.length && r.chance(p) ? r.between(0, ctx.customers.length - 1) : null);

  const dineIn = (h0: number, h1: number) => {
    const covers = r.chance(0.15) ? r.between(5, 8) : r.between(1, 4);
    const openAt = at(r.between(h0, h1), r.between(0, 59));
    const items = chooseItems(ctx, r, covers, true);
    if (r.chance(0.05) && items.length > 2) items[r.between(0, items.length - 1)].voidReason = r.pick(VOID_REASONS);
    const discount = r.chance(0.07) ? r.pick([500, 1000, 1500]) : 0;
    const m = method();
    plans.push({
      type: "DINE_IN", tableIdx: r.between(0, ctx.tables.length - 1), serverIdx: r.between(0, ctx.servers.length - 1), covers, openAt, closeAt: new Date(openAt.getTime() + r.between(45, 110) * 60000),
      items, discount, discountReason: discount ? r.pick(DISCOUNT_REASONS) : undefined, cancelReason: r.chance(0.015) ? r.pick(CANCEL_REASONS) : undefined, customerIdx: customer(0.3),
      method: m, tipRate: 0 /* pas de pourboires en Polynésie : la caisse ne les enregistre pas */, split: m === "CARD" && covers >= 2 && r.chance(0.2), refund: r.chance(0.012) ? { part: r.pick([0.3, 0.5, 1]), reason: r.pick(REFUND_REASONS) } : undefined,
    });
  };
  const counter = (type: OrderType, h0: number, h1: number, meta: () => Record<string, unknown>) => {
    const openAt = at(r.between(h0, h1), r.between(0, 59));
    const covers = r.between(1, 2);
    plans.push({ type, tableIdx: null, serverIdx: r.between(0, ctx.servers.length - 1), covers, openAt, closeAt: new Date(openAt.getTime() + r.between(12, 30) * 60000), items: chooseItems(ctx, r, covers, false), discount: 0, customerIdx: type === "ONLINE" || type === "DELIVERY" ? customer(0.6) : customer(0.1), method: type === "KIOSK" ? (r.chance(0.7) ? "CARD" : "CASH") : r.chance(0.6) ? "CARD" : "CASH", tipRate: 0, split: false, meta: meta() });
  };

  const weekend = dow === 0 || dow === 6;
  const lunch = weekend ? r.between(18, 26) : r.between(10, 18);
  const dinner = dow === 0 ? 0 : dow === 5 || dow === 6 ? r.between(16, 24) : r.between(8, 14);
  for (let i = 0; i < lunch; i++) dineIn(11, 13);
  for (let i = 0; i < dinner; i++) dineIn(18, 21);
  for (let i = r.between(2, 5); i > 0; i--) counter("TAKEAWAY", 11, 13, () => ({}));
  for (let i = r.between(1, 3); i > 0; i--) counter("ONLINE", 11, dow === 0 ? 13 : 20, () => ({ channel: "PICKUP", name: r.pick(CHANNEL_NAMES), when: "Dès que possible" }));
  for (let i = dow === 0 ? 0 : r.between(0, 2); i > 0; i--) counter("DELIVERY", 18, 20, () => ({ channel: "DELIVERY", name: r.pick(CHANNEL_NAMES), zone: r.pick(["Punaauia", "Paea", "Faa'a"]), deliveryFee: ctx.deliveryFee }));
  for (let i = r.between(1, 4); i > 0; i--) counter("KIOSK", 11, 13, () => ({ channel: "KIOSK", mode: r.chance(0.6) ? "TAKEAWAY" : "DINE_IN", name: r.pick(CHANNEL_NAMES) }));
  return plans.sort((a, b) => a.openAt.getTime() - b.openAt.getTime()).map((p, i) => ({ ...p, seq: i + 1 }));
}

// ---------------------------------------------------------------- écriture

const number = (day: string, seq: number) => `${day.replace(/-/g, "")}-${String(seq).padStart(4, "0")}`;
type Tx = PrismaClient | Prisma.TransactionClient;

/** Commande terminée (payée ou annulée) ; renvoie l'id, le total et les lignes vendues (pour le stock). */
async function writeClosedOrder(db: Tx, ctx: DemoCtx, day: string, o: PlanOrder, cashSessionId: string | null, opts: { audit: boolean; ticket: boolean; usedNumbers: Set<string> }) {
  let n = number(day, o.seq);
  for (let k = o.seq; opts.usedNumbers.has(n); k += 1000) n = number(day, FIRST_FREE_NUMBER + k);
  opts.usedNumbers.add(n);
  const serverId = ctx.servers[o.serverIdx % ctx.servers.length];
  const multi = o.type === "DINE_IN";
  const customer = o.customerIdx !== null ? ctx.customers[o.customerIdx] : null;
  const meta = { ...(o.meta ?? {}), demo: true };
  const order = await db.order.create({
    data: {
      establishmentId: ctx.estId, number: n, type: o.type, tableId: o.tableIdx !== null ? ctx.tables[o.tableIdx % ctx.tables.length].id : null, serverId, covers: o.covers, openedAt: o.openAt, createdAt: o.openAt,
      customerId: customer?.id ?? null, customerName: customer?.name ?? (o.meta?.name as string | undefined) ?? null, status: "OPEN", channelMeta: meta as Prisma.InputJsonValue,
      acceptedAt: o.type === "ONLINE" || o.type === "DELIVERY" ? new Date(o.openAt.getTime() + 2 * 60000) : null,
      courses: { create: (multi ? COURSES : ["COMMANDE"]).map((name, i) => ({ name, sortOrder: i, status: "SERVED" })) },
    },
    include: { courses: { orderBy: { sortOrder: "asc" } } },
  });
  const lines: Parameters<typeof computeOrderTotals>[0] = [];
  const sold: { productId: string; quantity: number }[] = [];
  for (const [i, it] of o.items.entries()) {
    const modifiersTotal = it.mods.reduce((a, m) => a + m.priceDelta, 0);
    const calc = computeLine({ quantity: 1, unitPrice: it.p.priceTtc, modifiersTotal, discountAmount: 0, taxRateBps: it.p.taxRateBps });
    const voided = !!it.voidReason;
    if (!voided) { lines.push({ quantity: 1, unitPrice: it.p.priceTtc, modifiersTotal, discountAmount: 0, taxRateBps: it.p.taxRateBps, taxRateName: it.p.taxRateName }); sold.push({ productId: it.p.id, quantity: 1 }); }
    await db.orderItem.create({
      data: {
        orderId: order.id, courseId: order.courses[Math.min(it.course, order.courses.length - 1)].id, productId: it.p.id, kitchenStationId: it.p.stationId, name: it.p.name, quantity: 1, unitPrice: it.p.priceTtc, modifiersTotal, lineTotal: calc.lineTotal,
        taxRateBps: it.p.taxRateBps, taxRateName: it.p.taxRateName, taxAmount: calc.taxAmount, costPrice: it.p.costPrice, seatNumber: multi ? it.seat : null, sortOrder: i,
        status: voided ? "VOIDED" : "SERVED", voidedAt: voided ? new Date(o.openAt.getTime() + 10 * 60000) : null, voidReason: it.voidReason ?? null,
        sentAt: new Date(o.openAt.getTime() + 3 * 60000), servedAt: voided ? null : new Date(o.openAt.getTime() + 25 * 60000), createdAt: o.openAt,
        modifiers: it.mods.length ? { create: it.mods.map((m) => ({ modifierId: m.id, groupName: m.groupName, name: m.name, priceDelta: m.priceDelta })) } : undefined,
      },
    });
  }
  const totals = computeOrderTotals(lines, o.discount);
  const audit = (action: string, entityType: string, entityId: string, values: { reason?: string; newValue?: object; oldValue?: object }, at: Date) =>
    opts.audit ? db.auditLog.create({ data: { organizationId: ctx.orgId, establishmentId: ctx.estId, userId: action === "order.discount" || action === "payment.refund" || action === "order.cancel" ? ctx.managerId : serverId, action, entityType, entityId, reason: values.reason ?? null, newValue: values.newValue as Prisma.InputJsonValue, oldValue: values.oldValue as Prisma.InputJsonValue, createdAt: at } }) : null;

  for (const it of o.items.filter((x) => x.voidReason)) await audit("item.void", "order_item", order.id, { reason: it.voidReason, oldValue: { name: it.p.name, orderNumber: n } }, new Date(o.openAt.getTime() + 10 * 60000));
  if (o.cancelReason && o.type === "DINE_IN") {
    await db.order.update({ where: { id: order.id }, data: { status: "CANCELLED", cancelReason: o.cancelReason, closedAt: new Date(o.openAt.getTime() + 15 * 60000), subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total } });
    await audit("order.cancel", "order", order.id, { reason: o.cancelReason, oldValue: { number: n, total: totals.total } }, new Date(o.openAt.getTime() + 15 * 60000));
    return { id: order.id, total: 0, sold: [] as typeof sold, customerId: null as string | null };
  }
  if (o.discount) await audit("order.discount", "order", order.id, { reason: o.discountReason, newValue: { amount: o.discount, number: n } }, new Date(o.closeAt.getTime() - 5 * 60000));

  const tip = o.tipRate ? Math.round((totals.total * o.tipRate) / 100 / 100) * 100 : 0;
  const amounts = o.split ? [Math.floor(totals.total / 2), totals.total - Math.floor(totals.total / 2)] : [totals.total];
  for (const [i, amount] of amounts.entries()) {
    const tipAmount = i === 0 ? tip : 0;
    const cash = o.method === "CASH";
    const tendered = cash ? Math.ceil((amount + tipAmount) / 1000) * 1000 : null;
    const pay = await db.payment.create({ data: { establishmentId: ctx.estId, orderId: order.id, cashSessionId, receivedById: serverId, method: o.method, amount, tipAmount, tendered, changeGiven: cash ? tendered! - amount - tipAmount : 0, splitLabel: o.split ? `Part ${i + 1}/2` : null, createdAt: o.closeAt } });
    if (cash && cashSessionId) await db.cashMovement.create({ data: { cashSessionId, userId: serverId, paymentId: pay.id, orderId: order.id, kind: "SALE", amount: amount + tipAmount, reason: `Vente ${n}`, createdAt: o.closeAt } });
    if (o.refund && i === 0) {
      const refunded = Math.max(100, Math.round((amount * o.refund.part) / 100) * 100);
      const at = new Date(o.closeAt.getTime() + 20 * 60000);
      await db.refund.create({ data: { paymentId: pay.id, issuedById: ctx.managerId, amount: refunded, reason: o.refund.reason, createdAt: at } });
      await db.payment.update({ where: { id: pay.id }, data: { refundedAmount: refunded } });
      if (cash && cashSessionId) await db.cashMovement.create({ data: { cashSessionId, userId: ctx.managerId, paymentId: pay.id, orderId: order.id, kind: "REFUND", amount: -refunded, reason: `Remboursement ${n}`, createdAt: at } });
      await audit("payment.refund", "payment", pay.id, { reason: o.refund.reason, newValue: { amount: refunded, number: n } }, at);
    }
  }
  await db.order.update({ where: { id: order.id }, data: { status: "PAID", closedAt: o.closeAt, subtotal: totals.subtotal, discountTotal: totals.discountTotal, discountReason: o.discountReason ?? null, taxTotal: totals.taxTotal, total: totals.total, paidTotal: totals.total, tipTotal: tip } });
  if (opts.ticket) {
    const first = o.items.find((x) => !x.voidReason);
    await db.kitchenTicket.create({ data: { orderId: order.id, courseId: order.courses[0].id, stationId: first?.p.stationId ?? null, status: "DONE", createdAt: new Date(o.openAt.getTime() + 3 * 60000), acceptedAt: new Date(o.openAt.getTime() + 4 * 60000), startedAt: new Date(o.openAt.getTime() + 5 * 60000), readyAt: new Date(o.openAt.getTime() + 5 * 60000 + (9 + (o.seq % 9)) * 60000), completedAt: new Date(o.openAt.getTime() + 25 * 60000) } });
  }
  return { id: order.id, total: totals.total, sold, customerId: customer?.id ?? null };
}

// ---------------------------------------------------------------- journée complète (historique)

const sessionBounds = (ctx: DemoCtx, day: string) => {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const base = startOfLocalDay(day, ctx.tz).getTime();
  return { openedAt: new Date(base + 10.5 * 3600000), closedAt: new Date(base + (dow === 0 ? 15.5 : 22.5) * 3600000) };
};

/** Clôture d'une journée : sortie d'espèces, écart de caisse, consommation de stock, fidélité, pointages et réservations terminés. */
async function finalizeDay(prisma: PrismaClient, ctx: DemoCtx, day: string, sessionId: string) {
  const r = rngFor(`${ctx.estId}:${day}:close`);
  const { closedAt } = sessionBounds(ctx, day);
  const dayStart = startOfLocalDay(day, ctx.tz), dayEnd = new Date(dayStart.getTime() + 86400000);
  // Petites dépenses payées en espèces
  if (r.chance(0.4)) await prisma.cashMovement.create({ data: { cashSessionId: sessionId, userId: ctx.managerId, kind: "PAY_OUT", amount: -r.pick([1500, 2500, 3200, 4800]), reason: r.pick(["Achat glaçons", "Pain du jour", "Citrons au marché", "Bouteille de gaz"]), createdAt: new Date(closedAt.getTime() - 6 * 3600000) } });
  if (r.chance(0.08)) await prisma.cashMovement.create({ data: { cashSessionId: sessionId, userId: ctx.managerId, kind: "PAY_IN", amount: 10000, reason: "Appoint de monnaie", createdAt: new Date(closedAt.getTime() - 8 * 3600000) } });
  const moves = await prisma.cashMovement.findMany({ where: { cashSessionId: sessionId }, select: { amount: true } });
  const expected = moves.reduce((a, m) => a + m.amount, 0);
  const counted = expected + (r.chance(0.2) ? r.pick([-500, -100, 100, 200]) : 0);
  await prisma.cashSession.update({ where: { id: sessionId }, data: { status: "CLOSED", closedById: ctx.managerId, closedAt, expectedCash: expected, countedCash: counted, difference: counted - expected } });
  await prisma.auditLog.create({ data: { organizationId: ctx.orgId, establishmentId: ctx.estId, userId: ctx.managerId, action: "cash.close", entityType: "cash_session", entityId: sessionId, newValue: { expected, counted, difference: counted - expected }, createdAt: closedAt } });

  // Consommation de stock d'après les recettes des plats vendus
  const items = await prisma.orderItem.findMany({ where: { status: { not: "VOIDED" }, productId: { not: null }, order: { establishmentId: ctx.estId, status: "PAID", closedAt: { gte: dayStart, lt: dayEnd } } }, select: { productId: true, quantity: true } });
  const use = new Map<string, { qty: number; cost: number }>();
  for (const it of items) for (const line of ctx.recipes.get(it.productId!) ?? []) { const u = use.get(line.ingredientId) ?? { qty: 0, cost: line.avgCost }; u.qty += line.quantity * it.quantity; use.set(line.ingredientId, u); }
  if (use.size) await prisma.inventoryMovement.createMany({ data: [...use].map(([ingredientId, u]) => ({ establishmentId: ctx.estId, ingredientId, kind: "SALE" as const, quantity: -Math.round(u.qty * 1000) / 1000, unitCost: u.cost, reason: "Ventes du jour", createdAt: closedAt })) });
  // Réception d'une commande fournisseur environ un jour sur trois
  if (ctx.supplierProducts.length && r.chance(0.35)) {
    const supplierId = r.pick(ctx.supplierProducts).supplierId;
    const lines = ctx.supplierProducts.filter((s) => s.supplierId === supplierId).slice(0, 3).map((s) => ({ s, qty: r.between(2, 5) }));
    const poNumber = `BC-${day.replace(/-/g, "")}-D1`;
    if (!(await prisma.purchaseOrder.findFirst({ where: { establishmentId: ctx.estId, number: poNumber } }))) {
      const receivedAt = new Date(dayStart.getTime() + 9 * 3600000);
      await prisma.purchaseOrder.create({ data: { establishmentId: ctx.estId, supplierId, number: poNumber, status: "RECEIVED", total: lines.reduce((a, l) => a + l.qty * l.s.lastPrice, 0), createdAt: new Date(receivedAt.getTime() - 86400000), receivedAt, lines: { create: lines.map((l) => ({ supplierProductId: l.s.id, quantity: l.qty, receivedQty: l.qty, unitPrice: l.s.lastPrice })) } } });
      await prisma.inventoryMovement.createMany({ data: lines.map((l) => ({ establishmentId: ctx.estId, ingredientId: l.s.ingredientId, userId: ctx.managerId, kind: "PURCHASE" as const, quantity: l.qty * l.s.packSize, unitCost: Math.round(l.s.lastPrice / Math.max(1, l.s.packSize)), reason: `Réception ${poNumber}`, createdAt: receivedAt })) });
    }
  }

  // Fidélité : points des clients reconnus
  const withCustomer = await prisma.order.findMany({ where: { establishmentId: ctx.estId, status: "PAID", customerId: { not: null }, closedAt: { gte: dayStart, lt: dayEnd } }, select: { id: true, number: true, total: true, closedAt: true, customerId: true } });
  for (const o of withCustomer) {
    const points = Math.floor(o.total / 100) * ctx.pointsPer100;
    const acc = await prisma.loyaltyAccount.upsert({ where: { establishmentId_customerId: { establishmentId: ctx.estId, customerId: o.customerId! } }, update: { points: { increment: points } }, create: { establishmentId: ctx.estId, customerId: o.customerId!, points } });
    await prisma.loyaltyTransaction.create({ data: { accountId: acc.id, orderId: o.id, points, reason: `Commande ${o.number}`, createdAt: o.closedAt! } });
    await prisma.customer.update({ where: { id: o.customerId! }, data: { visitCount: { increment: 1 }, totalSpent: { increment: o.total } } });
  }

  // Pointages restés ouverts : départ en fin de service
  for (const e of ctx.employees) {
    const last = await prisma.timeEntry.findFirst({ where: { employeeId: e.id, at: { gte: dayStart, lt: dayEnd } }, orderBy: { at: "desc" } });
    if (last && last.kind !== "CLOCK_OUT") {
      if (last.kind === "BREAK_START") await prisma.timeEntry.create({ data: { establishmentId: ctx.estId, employeeId: e.id, kind: "BREAK_END", at: new Date(last.at.getTime() + 20 * 60000) } });
      await prisma.timeEntry.create({ data: { establishmentId: ctx.estId, employeeId: e.id, kind: "CLOCK_OUT", at: new Date(Math.max(closedAt.getTime(), last.at.getTime() + 30 * 60000)) } });
    }
  }
  // Réservations du jour restées en attente
  const pending = await prisma.reservation.findMany({ where: { establishmentId: ctx.estId, startsAt: { gte: dayStart, lt: dayEnd }, status: { in: ["PENDING", "CONFIRMED", "ARRIVED", "SEATED"] } }, select: { id: true } });
  for (const [i, res] of pending.entries()) await prisma.reservation.update({ where: { id: res.id }, data: { status: i % 7 === 6 ? "NO_SHOW" : "COMPLETED" } });
}

/** Planning et pointages d'une journée passée. */
async function staffDay(prisma: PrismaClient, ctx: DemoCtx, day: string, withEntries: boolean) {
  const r = rngFor(`${ctx.estId}:${day}:staff`);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const at = (h: number, m = 0) => new Date(startOfLocalDay(day, ctx.tz).getTime() + (h * 60 + m) * 60000);
  const shifts: Prisma.ShiftCreateManyInput[] = [], entries: Prisma.TimeEntryCreateManyInput[] = [];
  for (const [i, e] of ctx.employees.entries()) {
    if (dow === (i % 6) + 1) continue; // un jour de repos par semaine
    const lunch = i % 3 !== 2, dinner = dow !== 0 && i % 3 !== 1;
    if (lunch) shifts.push({ establishmentId: ctx.estId, employeeId: e.id, startsAt: at(10, 30), endsAt: at(15), notes: "Midi" });
    if (dinner) shifts.push({ establishmentId: ctx.estId, employeeId: e.id, startsAt: at(17, 30), endsAt: at(22, 30), notes: "Soir" });
    if (!withEntries) continue;
    const j = () => r.between(-8, 12);
    if (lunch) entries.push({ establishmentId: ctx.estId, employeeId: e.id, kind: "CLOCK_IN", at: at(10, 30 + j()) }, { establishmentId: ctx.estId, employeeId: e.id, kind: "BREAK_START", at: at(13, j() + 8) }, { establishmentId: ctx.estId, employeeId: e.id, kind: "BREAK_END", at: at(13, 33 + j()) }, { establishmentId: ctx.estId, employeeId: e.id, kind: "CLOCK_OUT", at: at(15, 5 + j()) });
    if (dinner) entries.push({ establishmentId: ctx.estId, employeeId: e.id, kind: "CLOCK_IN", at: at(17, 30 + j()) }, { establishmentId: ctx.estId, employeeId: e.id, kind: "CLOCK_OUT", at: at(22, 35 + j()) });
  }
  if (shifts.length) await prisma.shift.createMany({ data: shifts });
  if (entries.length) await prisma.timeEntry.createMany({ data: entries });
}

const RES_NAMES = ["Famille Teriierooiterai", "Anniversaire de Moea", "Pot de départ Air Tahiti", "Repas d'affaires OPT", "Famille Lehartel", "Club de va'a", "Couple Martin", "Groupe de randonneurs", "Famille Wong", "Mariage Tetuanui (apéritif)"];

/** Réservations d'une journée (passée ou à venir), si la journée n'en a pas encore. */
async function reservationsDay(prisma: PrismaClient, ctx: DemoCtx, day: string, today: string) {
  const dayStart = startOfLocalDay(day, ctx.tz);
  if (await prisma.reservation.count({ where: { establishmentId: ctx.estId, startsAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86400000) } } })) return;
  const r = rngFor(`${ctx.estId}:${day}:resa`);
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const count = dow === 5 || dow === 6 ? r.between(5, 9) : r.between(2, 5);
  const data: Prisma.ReservationCreateManyInput[] = [];
  const usedTables = new Set<number>();
  for (let i = 0; i < count; i++) {
    const dinner = dow !== 0 && r.chance(0.6);
    const c = ctx.customers.length && r.chance(0.6) ? ctx.customers[r.between(0, ctx.customers.length - 1)] : null;
    const status = day < today ? (r.chance(0.08) ? "NO_SHOW" : r.chance(0.06) ? "CANCELLED" : "COMPLETED") : r.chance(0.9) ? "CONFIRMED" : "PENDING"; // quelques demandes en ligne à valider (grande alerte de la caisse)
    const party = r.chance(0.12) ? r.between(8, 14) : r.between(2, 6);
    const name = c?.name ?? r.pick(RES_NAMES);
    // Tables déjà attribuées aux réservations confirmées à venir (une table par réservation et par jour)
    let tableId: string | null = null;
    if (day >= today && status === "CONFIRMED" && r.chance(0.75)) {
      const t = r.between(0, ctx.tables.length - 1);
      if (!usedTables.has(t)) { usedTables.add(t); tableId = ctx.tables[t].id; }
    }
    const tags = [/Anniversaire/.test(name) ? "birthday" : null, /affaires/.test(name) ? "business" : null, r.chance(0.15) ? r.pick(["terrace", "quiet", "baby"]) : null].filter((x): x is string => !!x);
    // Reçues quelques jours plus tôt : les demandes en ligne de l'exemple s'affichent dans le bandeau « à valider »
    // sans ouvrir d'elles-mêmes le grand message réservé aux demandes qui viennent d'arriver
    data.push({ establishmentId: ctx.estId, customerId: c?.id ?? null, name, tableId, tags, createdAt: new Date(Math.min(Date.now(), dayStart.getTime()) - 3 * 86_400_000), source: status === "PENDING" ? "ONLINE" : r.chance(0.85) ? "PHONE" : "WALK_IN", phone: c?.phone ?? null, startsAt: new Date(dayStart.getTime() + ((dinner ? r.between(18, 20) : r.between(11, 13)) * 60 + r.pick([0, 15, 30, 45])) * 60000), partySize: party, status, allergies: r.chance(0.12) ? r.pick(["Gluten", "Fruits de mer", "Arachides", "Lactose"]) : null, notes: party >= 8 ? "Grande table, prévoir l'installation" : r.chance(0.15) ? r.pick(["Près de la mer si possible", "Chaise bébé", "Gâteau apporté par le client"]) : null });
  }
  await prisma.reservation.createMany({ data });
}

/** Génère une journée passée complète : caisse, commandes, planning, pointages, puis clôture. */
async function generateDay(prisma: PrismaClient, ctx: DemoCtx, day: string) {
  const { openedAt } = sessionBounds(ctx, day);
  const session = await prisma.cashSession.create({ data: { establishmentId: ctx.estId, openedById: ctx.managerId, status: "OPEN", openingFloat: 30000, openedAt } });
  await prisma.cashMovement.create({ data: { cashSessionId: session.id, userId: ctx.managerId, kind: "OPENING", amount: 30000, reason: "Fond de caisse", createdAt: openedAt } });
  const used = new Set((await prisma.order.findMany({ where: { establishmentId: ctx.estId, number: { startsWith: day.replace(/-/g, "") } }, select: { number: true } })).map((o) => o.number));
  const plan = dayPlan(ctx, day);
  for (const o of plan) await writeClosedOrder(prisma, ctx, day, o, session.id, { audit: true, ticket: false, usedNumbers: used });
  await prisma.orderCounter.upsert({ where: { establishmentId_day: { establishmentId: ctx.estId, day } }, update: { value: Math.max(plan.length, FIRST_FREE_NUMBER) }, create: { establishmentId: ctx.estId, day, value: Math.max(plan.length, FIRST_FREE_NUMBER) } });
  await staffDay(prisma, ctx, day, true);
  await finalizeDay(prisma, ctx, day, session.id);
}

// ---------------------------------------------------------------- service du jour

const isDemoOrder = { channelMeta: { path: ["demo"], equals: true } } satisfies Prisma.OrderWhereInput;

/** Supprime des commandes en retirant d'abord leurs mouvements de caisse (le lien vers la commande n'est pas en cascade). */
async function deleteOrders(prisma: PrismaClient, where: Prisma.OrderWhereInput) {
  const ids = (await prisma.order.findMany({ where, select: { id: true } })).map((o) => o.id);
  if (!ids.length) return 0;
  await prisma.cashMovement.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.loyaltyTransaction.deleteMany({ where: { orderId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

/** Une table en cours : articles, tickets cuisine selon l'avancement, statut des articles. */
/** Il y a « minutes » minutes, mais jamais avant minuit du jour (sinon la commande compterait pour la veille) */
const agoToday = (ctx: DemoCtx, day: string, minutes: number) => new Date(Math.max(startOfLocalDay(day, ctx.tz).getTime() + 60000, Date.now() - minutes * 60000));

async function writeLiveTable(prisma: PrismaClient, ctx: DemoCtx, day: string, seq: number, tableIdx: number, minutesAgo: number, r: Rng, usedNumbers: Set<string>) {
  const openAt = agoToday(ctx, day, minutesAgo);
  const covers = r.between(2, 5);
  let n = number(day, seq);
  for (let k = seq; usedNumbers.has(n); k += 1000) n = number(day, FIRST_FREE_NUMBER + k);
  usedNumbers.add(n);
  const serverId = ctx.servers[tableIdx % ctx.servers.length];
  const order = await prisma.order.create({ data: { establishmentId: ctx.estId, number: n, type: "DINE_IN", tableId: ctx.tables[tableIdx].id, serverId, covers, openedAt: openAt, createdAt: openAt, status: "OPEN", channelMeta: { demo: true }, courses: { create: COURSES.map((name, i) => ({ name, sortOrder: i })) } }, include: { courses: { orderBy: { sortOrder: "asc" } } } });
  const items = chooseItems(ctx, r, covers, true);
  const sent = minutesAgo >= 6;
  const lines: Parameters<typeof computeOrderTotals>[0] = [];
  const created: { id: string; courseIdx: number; stationId: string | null }[] = [];
  for (const [i, it] of items.entries()) {
    const modifiersTotal = it.mods.reduce((a, m) => a + m.priceDelta, 0);
    const calc = computeLine({ quantity: 1, unitPrice: it.p.priceTtc, modifiersTotal, discountAmount: 0, taxRateBps: it.p.taxRateBps });
    lines.push({ quantity: 1, unitPrice: it.p.priceTtc, modifiersTotal, discountAmount: 0, taxRateBps: it.p.taxRateBps, taxRateName: it.p.taxRateName });
    // Les desserts attendent la fin du repas ; le reste part en cuisine
    const goes = sent && (it.course !== 3 || minutesAgo > 45);
    const row = await prisma.orderItem.create({ data: { orderId: order.id, courseId: order.courses[it.course].id, productId: it.p.id, kitchenStationId: it.p.stationId, name: it.p.name, quantity: 1, unitPrice: it.p.priceTtc, modifiersTotal, lineTotal: calc.lineTotal, taxRateBps: it.p.taxRateBps, taxRateName: it.p.taxRateName, taxAmount: calc.taxAmount, costPrice: it.p.costPrice, seatNumber: it.seat, sortOrder: i, status: goes ? "SENT" : "PENDING", sentAt: goes ? new Date(openAt.getTime() + 4 * 60000) : null, createdAt: openAt, modifiers: it.mods.length ? { create: it.mods.map((m) => ({ modifierId: m.id, groupName: m.groupName, name: m.name, priceDelta: m.priceDelta })) } : undefined } });
    if (goes) created.push({ id: row.id, courseIdx: it.course, stationId: it.p.stationId });
  }
  const groups = new Map<string, typeof created>();
  for (const it of created) { const k = `${it.courseIdx}|${it.stationId ?? "none"}`; groups.set(k, [...(groups.get(k) ?? []), it]); }
  for (const [k, its] of groups) {
    const [courseIdx, stationId] = k.split("|");
    const at = new Date(openAt.getTime() + 4 * 60000);
    const age = (Date.now() - at.getTime()) / 60000;
    const status = age < 3 ? "NEW" : age < 6 ? "ACCEPTED" : age < 16 ? "IN_PROGRESS" : "READY";
    const later = (min: number) => new Date(Math.min(Date.now(), at.getTime() + min * 60000));
    const ticket = await prisma.kitchenTicket.create({ data: { orderId: order.id, courseId: order.courses[Number(courseIdx)].id, stationId: stationId === "none" ? null : stationId, status, isUrgent: r.chance(0.12), createdAt: at, acceptedAt: status === "NEW" ? null : later(1), startedAt: status === "NEW" || status === "ACCEPTED" ? null : later(3), readyAt: status === "READY" ? later(14) : null } });
    await prisma.orderItem.updateMany({ where: { id: { in: its.map((i) => i.id) } }, data: { kitchenTicketId: ticket.id, ...(status === "IN_PROGRESS" ? { status: "PREPARING" } : status === "READY" ? { status: "READY", readyAt: later(14) } : {}) } });
    await prisma.course.update({ where: { id: order.courses[Number(courseIdx)].id }, data: { status: status === "READY" ? "READY" : "SENT" } });
  }
  const totals = computeOrderTotals(lines, 0);
  await prisma.order.update({ where: { id: order.id }, data: { status: created.length ? "SENT" : "OPEN", subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total } });
  return order;
}

async function writePendingChannel(prisma: PrismaClient, ctx: DemoCtx, day: string, seq: number, type: "ONLINE" | "DELIVERY" | "KIOSK", r: Rng, accepted: boolean, meta: Record<string, unknown>, usedNumbers: Set<string>) {
  let n = number(day, seq);
  for (let k = seq; usedNumbers.has(n); k += 1000) n = number(day, FIRST_FREE_NUMBER + k);
  usedNumbers.add(n);
  const minutesAgo = r.between(3, 9);
  const openAt = agoToday(ctx, day, minutesAgo);
  const c = type !== "KIOSK" && ctx.customers.length ? ctx.customers[r.between(0, ctx.customers.length - 1)] : null;
  const items = chooseItems(ctx, r, r.between(1, 2), false);
  const o = await prisma.order.create({ data: { establishmentId: ctx.estId, number: n, type, serverId: ctx.ownerId, covers: 1, customerId: c?.id ?? null, customerName: c?.name ?? (meta.name as string) ?? null, status: accepted ? "SENT" : "OPEN", publicToken: crypto.randomUUID(), channelMeta: { ...meta, demo: true, phone: c?.phone ?? meta.phone ?? null, awaitingAcceptance: !accepted } as Prisma.InputJsonValue, acceptedAt: accepted ? new Date(openAt.getTime() + 60000) : null, openedAt: openAt, createdAt: openAt, courses: { create: [{ name: "COMMANDE", sortOrder: 0, status: accepted ? "SENT" : "PENDING" }] } }, include: { courses: true } });
  const lines: Parameters<typeof computeOrderTotals>[0] = [];
  for (const [i, it] of items.entries()) {
    const calc = computeLine({ quantity: 1, unitPrice: it.p.priceTtc, modifiersTotal: 0, discountAmount: 0, taxRateBps: it.p.taxRateBps });
    lines.push({ quantity: 1, unitPrice: it.p.priceTtc, modifiersTotal: 0, discountAmount: 0, taxRateBps: it.p.taxRateBps, taxRateName: it.p.taxRateName });
    await prisma.orderItem.create({ data: { orderId: o.id, courseId: o.courses[0].id, productId: it.p.id, kitchenStationId: it.p.stationId, name: it.p.name, quantity: 1, unitPrice: it.p.priceTtc, lineTotal: calc.lineTotal, taxRateBps: it.p.taxRateBps, taxRateName: it.p.taxRateName, taxAmount: calc.taxAmount, costPrice: it.p.costPrice, sortOrder: i, status: accepted ? "SENT" : "PENDING", sentAt: accepted ? new Date(openAt.getTime() + 60000) : null, createdAt: openAt } });
  }
  const totals = computeOrderTotals(lines, 0);
  await prisma.order.update({ where: { id: o.id }, data: { subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total } });
  if (accepted) {
    const t = await prisma.kitchenTicket.create({ data: { orderId: o.id, courseId: o.courses[0].id, stationId: items[0].p.stationId, status: "IN_PROGRESS", createdAt: new Date(openAt.getTime() + 60000), acceptedAt: new Date(openAt.getTime() + 2 * 60000), startedAt: new Date(openAt.getTime() + 3 * 60000) } });
    await prisma.orderItem.updateMany({ where: { orderId: o.id }, data: { kitchenTicketId: t.id, status: "PREPARING" } });
  }
}

/** Renouvelle le service du jour : commandes encaissées jusqu'à maintenant, tables en cours, commandes en ligne, équipe. */
async function refreshToday(prisma: PrismaClient, ctx: DemoCtx, today: string) {
  const dayStart = startOfLocalDay(today, ctx.tz);
  await deleteOrders(prisma, { establishmentId: ctx.estId, openedAt: { gte: dayStart }, ...isDemoOrder });

  // Caisse du jour : celle déjà ouverte (par la démo ou un visiteur), sinon ouverte à 10 h 30
  let session = await prisma.cashSession.findFirst({ where: { establishmentId: ctx.estId, status: "OPEN" }, orderBy: { openedAt: "desc" } });
  if (!session) {
    // Jamais avant minuit : une caisse ouverte la veille serait clôturée au rafraîchissement suivant
    const openedAt = new Date(Math.max(dayStart.getTime(), Math.min(sessionBounds(ctx, today).openedAt.getTime(), Date.now() - 30 * 60000)));
    session = await prisma.cashSession.create({ data: { establishmentId: ctx.estId, openedById: ctx.managerId, status: "OPEN", openingFloat: 30000, openedAt } });
    await prisma.cashMovement.create({ data: { cashSessionId: session.id, userId: ctx.managerId, kind: "OPENING", amount: 30000, reason: "Fond de caisse", createdAt: openedAt } });
  }

  const used = new Set((await prisma.order.findMany({ where: { establishmentId: ctx.estId, number: { startsWith: today.replace(/-/g, "") } }, select: { number: true } })).map((o) => o.number));
  const plan = dayPlan(ctx, today);
  const now = Date.now();
  // Plan du jour encaissé jusqu'à maintenant ; si la journée commence à peine, quelques ventes du matin pour ne pas afficher 0
  let done = plan.filter((o) => o.closeAt.getTime() <= now);
  // Tôt le matin (avant l'ouverture), on avance 6 vraies ventes du planning : jamais une commande annulée, qui ne compte pas en CA
  if (done.filter((o) => !o.cancelReason).length < 6) done = plan.filter((o) => !o.cancelReason).slice(0, 6).map((o, i) => {
    // Encaissées dans l'heure écoulée, mais toujours aujourd'hui (juste après minuit : réparties depuis minuit)
    const ideal = now - (20 + i * 9) * 60000;
    const closeAt = new Date(ideal >= dayStart.getTime() ? ideal : dayStart.getTime() + Math.floor(((now - dayStart.getTime()) * (6 - i)) / 7));
    // Ouvertes aujourd'hui aussi : sinon le rafraîchissement suivant ne les retrouverait pas et les doublerait
    return { ...o, openAt: new Date(Math.max(dayStart.getTime(), closeAt.getTime() - 50 * 60000)), closeAt };
  });
  for (const o of done) await writeClosedOrder(prisma, ctx, today, o, session.id, { audit: false, ticket: true, usedNumbers: used });

  // Tables en cours (sauf celles qu'un visiteur occupe déjà)
  const busy = new Set((await prisma.order.findMany({ where: { establishmentId: ctx.estId, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] }, tableId: { not: null } }, select: { tableId: true } })).map((o) => o.tableId));
  const r = rngFor(`${ctx.estId}:${today}:${new Date(now).getUTCHours()}:live`);
  let seq = plan.length + 1;
  const live = [];
  for (const [i, t] of LIVE_TABLES.entries()) {
    if (t >= ctx.tables.length || busy.has(ctx.tables[t].id)) continue;
    live.push(await writeLiveTable(prisma, ctx, today, seq++, t, [4, 12, 24, 38, 58][i], r, used));
  }
  await writePendingChannel(prisma, ctx, today, seq++, "ONLINE", r, false, { channel: "PICKUP", name: "Hina Tetuanui", when: "Dans 30 min", lang: "fr" }, used);
  await writePendingChannel(prisma, ctx, today, seq++, "DELIVERY", r, false, { channel: "DELIVERY", name: "Vaimiti Pambrun", when: "Dès que possible", address: "PK 15,8 côté montagne, portail vert", zone: "Punaauia", deliveryFee: ctx.deliveryFee, lang: "fr" }, used);
  await writePendingChannel(prisma, ctx, today, seq++, "KIOSK", r, true, { channel: "KIOSK", name: "Moe", mode: "TAKEAWAY", payAtCounter: true, lang: "en" }, used);
  // Les commandes des visiteurs prennent leurs numéros après ceux réservés à la démo
  // (et jamais avant un numéro déjà pris : sinon la prochaine commande d'un visiteur échouerait sur un doublon)
  const counter = await prisma.orderCounter.findUnique({ where: { establishmentId_day: { establishmentId: ctx.estId, day: today } } });
  const highest = Math.max(0, ...[...used].map((n) => Number(n.split("-")[1]) || 0));
  const value = Math.max(FIRST_FREE_NUMBER, counter?.value ?? 0, highest);
  await prisma.orderCounter.upsert({ where: { establishmentId_day: { establishmentId: ctx.estId, day: today } }, update: { value }, create: { establishmentId: ctx.estId, day: today, value } });

  // Parcours de service et rappels des tables en cours (un rappel en retard pour l'exemple)
  const { startTracking, onTicketReady } = await import("../src/server/services/service-tracking");
  const fresh = await prisma.order.findMany({ where: { id: { in: live.map((o) => o.id) } }, include: { kitchenTickets: { include: { items: true } } } });
  for (const o of fresh) {
    const actor = { organizationId: ctx.orgId, establishmentId: ctx.estId, userId: o.serverId ?? ctx.ownerId };
    await prisma.$transaction(async (tx) => startTracking(tx, actor, o));
    for (const t of o.kitchenTickets.filter((t) => t.status === "READY")) await onTicketReady(actor, { id: t.id, orderId: o.id, items: t.items, order: { tableId: o.tableId, serverId: o.serverId, type: o.type } });
  }
  const late = await prisma.serviceReminder.findFirst({ where: { establishmentId: ctx.estId, status: "OPEN", kind: "TAKE_ORDER", orderId: { in: live.map((o) => o.id) } }, orderBy: { createdAt: "asc" } });
  if (late) await prisma.serviceReminder.update({ where: { id: late.id }, data: { dueAt: new Date(now - 9 * 60000) } });

  // Équipe : pointée selon l'heure (une seule fois par jour, pour ne pas écraser les essais des visiteurs)
  if (!(await prisma.timeEntry.count({ where: { establishmentId: ctx.estId, at: { gte: dayStart } } }))) {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: ctx.tz, hour: "numeric", hourCycle: "h23" }).format(new Date(now)));
    const onDuty = hour >= 10 && hour < 23 ? ctx.employees.slice(0, 6) : ctx.employees.slice(0, 3);
    await prisma.timeEntry.createMany({ data: onDuty.flatMap((e, i) => [{ establishmentId: ctx.estId, employeeId: e.id, kind: "CLOCK_IN" as const, at: new Date(now - (90 + i * 11) * 60000) }, ...(i === 2 ? [{ establishmentId: ctx.estId, employeeId: e.id, kind: "BREAK_START" as const, at: new Date(now - 8 * 60000) }] : [])]) });
  }
}

// ---------------------------------------------------------------- point d'entrée

/**
 * Rafraîchit la démo : clôt les journées passées restées ouvertes, génère les journées manquantes,
 * renouvelle le service du jour, prolonge planning et réservations, supprime l'activité trop ancienne.
 * Sûr à relancer à tout moment (verrou contre les exécutions simultanées).
 */
export async function refreshDemo(prisma: PrismaClient, opts: { historyDays?: number; log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  const ctx = await loadDemoContext(prisma);
  if (!ctx) { log("Démo absente ou incomplète : rien à rafraîchir."); return null; }
  // Un seul rafraîchissement à la fois : bail de 30 min (un verrou de session PostgreSQL pourrait être libéré sur
  // une autre connexion du pool et rester pris ; un bail abandonné par un processus arrêté expire tout seul)
  if (!(await takeRefreshLease(prisma))) { log("Rafraîchissement déjà en cours : ignoré."); return null; }
  try {
    const today = localDay(new Date(), ctx.tz);
    const todayStart = startOfLocalDay(today, ctx.tz);

    // Commandes restées ouvertes d'un jour sur l'autre (générées ou saisies par des visiteurs)
    const stale = await deleteOrders(prisma, { establishmentId: ctx.estId, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] }, openedAt: { lt: todayStart } });
    if (stale) log(`→ ${stale} commande(s) restée(s) ouverte(s) supprimée(s)`);

    // Caisses des jours passés restées ouvertes : clôturées avec leur journée
    for (const s of await prisma.cashSession.findMany({ where: { establishmentId: ctx.estId, status: "OPEN", openedAt: { lt: todayStart } }, orderBy: { openedAt: "asc" } })) {
      await finalizeDay(prisma, ctx, localDay(s.openedAt, ctx.tz), s.id);
    }

    // Cave à vin : vins, emplacements, formats de vente, accords et bouteilles ouvertes (une seule fois),
    // avant l'activité du jour pour que les tables commandent aussi du vin
    const wines = await wineDemo(prisma, ctx);
    if (wines) { log(`→ Cave à vin : ${wines} vins`); ctx.vins = (await loadDemoContext(prisma))?.vins ?? []; }

    // Journées manquantes jusqu'à hier
    const last = await prisma.cashSession.findFirst({ where: { establishmentId: ctx.estId, openedAt: { lt: todayStart } }, orderBy: { openedAt: "desc" }, select: { openedAt: true } });
    const maxDays = opts.historyDays ?? HISTORY_DAYS;
    let from = last ? addDays(localDay(last.openedAt, ctx.tz), 1) : addDays(today, -maxDays);
    if (from < addDays(today, -maxDays)) from = addDays(today, -maxDays);
    let generated = 0;
    for (let d = from; d < today; d = addDays(d, 1)) { await generateDay(prisma, ctx, d); generated++; }
    if (generated) log(`→ ${generated} journée(s) d'activité générée(s)`);

    // Service du jour
    await refreshToday(prisma, ctx, today);

    // Planning des 7 prochains jours et réservations de -30 à +14 jours
    for (let i = 0; i <= 7; i++) {
      const d = addDays(today, i);
      const ds = startOfLocalDay(d, ctx.tz);
      if (!(await prisma.shift.count({ where: { establishmentId: ctx.estId, startsAt: { gte: ds, lt: new Date(ds.getTime() + 86400000) } } }))) await staffDay(prisma, ctx, d, false);
    }
    for (let i = -30; i <= 14; i++) await reservationsDay(prisma, ctx, addDays(today, i), today);
    // Réservations du jour dont l'heure est passée : terminées, ou installées si elles viennent d'arriver
    const nowMs = Date.now();
    await prisma.reservation.updateMany({ where: { establishmentId: ctx.estId, startsAt: { gte: todayStart, lt: new Date(nowMs - 90 * 60000) }, status: { in: ["PENDING", "CONFIRMED"] } }, data: { status: "COMPLETED" } });
    await prisma.reservation.updateMany({ where: { establishmentId: ctx.estId, startsAt: { gte: new Date(nowMs - 90 * 60000), lte: new Date(nowMs) }, status: { in: ["PENDING", "CONFIRMED"] } }, data: { status: "SEATED" } });

    // Hygiène & HACCP : relevés, nettoyages et traçabilité jusqu'à l'heure actuelle
    const hyg = await hygieneDemo(prisma, ctx, today);
    if (hyg.readings || hyg.cleaning) log(`→ Hygiène : ${hyg.readings} relevé(s), ${hyg.cleaning} nettoyage(s)`);

    // Comptes clients pro : quelques consommations sur compte à facturer (une seule fois)
    const acc = await accountsDemo(prisma, ctx, today);
    if (acc) log(`→ Comptes clients : ${acc} consommation(s) sur compte`);

    // Marketing : cartes cadeaux et clients inscrits aux offres (une seule fois)
    if (await marketingDemo(prisma, ctx, today)) log("→ Marketing : cartes cadeaux et clients inscrits");

    // Écrans en salle : comptoir et terrasse (une seule fois)
    if (await screensDemo(prisma, ctx)) log("→ Écrans en salle : comptoir et terrasse");

    // Bar : cave, fiches cocktails et happy hour (une seule fois) ; ardoises ouvertes au comptoir (renouvelées)
    const bar = await barDemo(prisma, ctx, today);
    if (bar) log(`→ Bar : ${bar} élément(s) (cave, fiches, ardoises)`);

    // Traiteur : un buffet facturé, un devis envoyé, un mariage confirmé (quand plus rien n'est à venir)
    const cat = await cateringDemo(prisma, ctx, today);
    if (cat) log(`→ Traiteur : ${cat} événement(s)`);

    // Activité trop ancienne
    const cutoff = startOfLocalDay(addDays(today, -KEEP_DAYS), ctx.tz);
    await deleteOrders(prisma, { establishmentId: ctx.estId, openedAt: { lt: cutoff }, ...isDemoOrder });
    await prisma.cashSession.deleteMany({ where: { establishmentId: ctx.estId, openedAt: { lt: cutoff } } });
    await prisma.timeEntry.deleteMany({ where: { establishmentId: ctx.estId, at: { lt: cutoff } } });
    await prisma.shift.deleteMany({ where: { establishmentId: ctx.estId, startsAt: { lt: cutoff } } });
    await prisma.inventoryMovement.deleteMany({ where: { establishmentId: ctx.estId, createdAt: { lt: cutoff } } });

    // L'essai affiché sur la démo reste celui d'un nouveau client
    await prisma.organization.update({ where: { id: ctx.orgId }, data: { trialEndsAt: new Date(Date.now() + 15 * 86400000) } });
    return { generated, today };
  } finally {
    await prisma.rateHit.deleteMany({ where: { key: REFRESH_LEASE } });
  }
}

const REFRESH_LEASE = "demo-refresh-lease";
const REFRESH_LEASE_MS = 30 * 60_000;
async function takeRefreshLease(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${REFRESH_LEASE}))`;
    if (await tx.rateHit.count({ where: { key: REFRESH_LEASE, at: { gt: new Date(Date.now() - REFRESH_LEASE_MS) } } })) return false;
    await tx.rateHit.deleteMany({ where: { key: REFRESH_LEASE } });
    await tx.rateHit.create({ data: { key: REFRESH_LEASE, at: new Date() } });
    return true;
  });
}
