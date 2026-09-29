import { prisma, type Tx } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { computeLine, computeOrderTotals } from "@/lib/order-calc";
import { applyBps } from "@/lib/money";
import { localDay } from "@/lib/dates";
import type { CourseStatus, OrderType, Prisma } from "@/generated/prisma/client";

export type Actor = { organizationId: string; establishmentId: string; userId: string; terminalId?: string | null; authorizedById?: string | null };

export const DEFAULT_COURSES = ["APÉRITIFS", "ENTRÉES", "PLATS", "DESSERTS"];
const OPEN_STATUSES = ["OPEN", "SENT", "BILL_REQUESTED"] as const;

export const orderInclude = {
  table: { select: { id: true, name: true, roomId: true, seats: true } },
  server: { select: { id: true, firstName: true, lastName: true, displayName: true } },
  courses: { orderBy: { sortOrder: "asc" as const } },
  items: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: { modifiers: true },
  },
  payments: { orderBy: { createdAt: "asc" as const }, include: { refunds: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithDetails = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

async function nextOrderNumber(tx: Tx, establishmentId: string, timezone: string) {
  const day = localDay(new Date(), timezone);
  const counter = await tx.orderCounter.upsert({
    where: { establishmentId_day: { establishmentId, day } },
    update: { value: { increment: 1 } },
    create: { establishmentId, day, value: 1 },
  });
  return `${day.replace(/-/g, "")}-${String(counter.value).padStart(4, "0")}`;
}

export async function getOrder(establishmentId: string, id: string, tx?: Tx): Promise<OrderWithDetails> {
  const order = await (tx ?? prisma).order.findFirst({ where: { id, establishmentId }, include: orderInclude });
  if (!order) throw new ApiError(404, "NOT_FOUND", "Commande introuvable");
  return order;
}

export async function listOpenOrders(establishmentId: string) {
  return prisma.order.findMany({ where: { establishmentId, status: { in: [...OPEN_STATUSES] } }, include: orderInclude, orderBy: { openedAt: "asc" } });
}

export async function listOrders(establishmentId: string, opts: { status?: string; from?: Date; to?: Date; tableId?: string; take?: number; skip?: number }) {
  const where: Prisma.OrderWhereInput = {
    establishmentId,
    ...(opts.status ? { status: opts.status as OrderWithDetails["status"] } : {}),
    ...(opts.tableId ? { tableId: opts.tableId } : {}),
    ...(opts.from || opts.to ? { openedAt: { gte: opts.from, lt: opts.to } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.order.findMany({ where, include: orderInclude, orderBy: { openedAt: "desc" }, take: opts.take ?? 50, skip: opts.skip ?? 0 }),
    prisma.order.count({ where }),
  ]);
  return { items, total };
}

/** Recalcule les totaux d'une commande à partir de ses lignes ; incrémente la version. */
export async function recalcOrder(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, payments: true } });
  const lines = order.items
    .map((i) => ({
      quantity: i.quantity, unitPrice: i.unitPrice, modifiersTotal: i.modifiersTotal, discountAmount: i.discountAmount,
      taxRateBps: i.taxRateBps, taxRateName: i.taxRateName, voided: i.status === "VOIDED",
    }));
  const totals = computeOrderTotals(lines, order.discountTotal);
  const paidTotal = order.payments.filter((p) => p.status !== "VOIDED").reduce((a, p) => a + p.amount - p.refundedAmount, 0);
  const tipTotal = order.payments.filter((p) => p.status !== "VOIDED").reduce((a, p) => a + p.tipAmount, 0);
  return tx.order.update({
    where: { id: orderId },
    data: { subtotal: totals.subtotal, discountTotal: totals.discountTotal, taxTotal: totals.taxTotal, total: totals.total, paidTotal, tipTotal, version: { increment: 1 } },
  });
}

function assertOpen(order: { status: string }) {
  if (!OPEN_STATUSES.includes(order.status as (typeof OPEN_STATUSES)[number])) {
    throw new ApiError(409, "ORDER_CLOSED", "Cette commande est clôturée");
  }
}

// ---------------------------------------------------------------- Création
export type CreateOrderInput = { id?: string; type: OrderType; tableId?: string | null; covers?: number; customerName?: string | null; notes?: string | null; courses?: { id: string; name: string }[]; openedAt?: string };

export async function createOrder(actor: Actor, input: CreateOrderInput) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId } });
  if (input.id) {
    const existing = await prisma.order.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (existing) return getOrder(actor.establishmentId, existing.id); // rejeu hors ligne idempotent
  }
  if (input.tableId) {
    const table = await prisma.table.findFirst({ where: { id: input.tableId, establishmentId: actor.establishmentId, isActive: true } });
    if (!table) throw new ApiError(400, "BAD_TABLE", "Table invalide");
    const open = await prisma.order.findFirst({ where: { tableId: input.tableId, status: { in: [...OPEN_STATUSES] } } });
    if (open) return getOrder(actor.establishmentId, open.id); // une seule commande ouverte par table
  }
  const settings = (est.settings ?? {}) as { courses?: string[] };
  const courseNames = input.type === "DINE_IN" ? (settings.courses?.length ? settings.courses : DEFAULT_COURSES) : ["COMMANDE"];
  const order = await prisma.$transaction(async (tx) => {
    const number = await nextOrderNumber(tx, actor.establishmentId, est.timezone);
    const o = await tx.order.create({
      data: {
        id: input.id, establishmentId: actor.establishmentId, number, type: input.type, tableId: input.tableId ?? null, serverId: actor.userId,
        terminalId: actor.terminalId ?? null, covers: input.covers ?? 1, customerName: input.customerName ?? null, notes: input.notes ?? null,
        openedAt: input.openedAt ? new Date(input.openedAt) : undefined,
        courses: { create: input.courses ? input.courses.map((c, i) => ({ id: c.id, name: c.name, sortOrder: i })) : courseNames.map((name, i) => ({ name, sortOrder: i })) },
      },
    });
    if (input.tableId) await tx.table.update({ where: { id: input.tableId }, data: { state: "FREE" } });
    return getOrder(actor.establishmentId, o.id, tx);
  });
  publish("order.created", actor.establishmentId, { orderId: order.id, tableId: order.tableId });
  publish("table.updated", actor.establishmentId, { tableId: order.tableId });
  return order;
}

export async function updateOrder(actor: Actor, orderId: string, input: { covers?: number; customerName?: string | null; notes?: string | null; type?: OrderType }) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  await prisma.order.update({ where: { id: orderId }, data: { covers: input.covers, customerName: input.customerName, notes: input.notes, type: input.type, version: { increment: 1 } } });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  return getOrder(actor.establishmentId, orderId);
}

// ---------------------------------------------------------------- Articles
export type AddItemInput = {
  id?: string;
  productId?: string;
  menuId?: string;
  variantId?: string | null;
  quantity?: number;
  courseId?: string | null;
  seatNumber?: number | null;
  notes?: string | null;
  isUrgent?: boolean;
  modifiers?: { modifierId: string; quantity?: number }[];
  menuSelections?: { sectionId: string; productId: string; modifiers?: { modifierId: string; quantity?: number }[] }[];
};

type ModifierSnapshot = { modifierId: string; groupName: string; name: string; priceDelta: number; quantity: number };

async function resolveModifiers(tx: Tx, productId: string, selections: { modifierId: string; quantity?: number }[]): Promise<ModifierSnapshot[]> {
  const groups = await tx.productModifierGroup.findMany({ where: { productId }, include: { modifierGroup: { include: { modifiers: true } } } });
  const result: ModifierSnapshot[] = [];
  for (const { modifierGroup: g } of groups) {
    if (!g.isActive) continue;
    const chosen = selections.filter((s) => g.modifiers.some((m) => m.id === s.modifierId));
    const count = chosen.reduce((a, s) => a + (s.quantity ?? 1), 0);
    if (count < g.minSelect) throw new ApiError(400, "MODIFIER_REQUIRED", `Choix obligatoire : ${g.name}`);
    if (g.maxSelect !== null && count > g.maxSelect) throw new ApiError(400, "MODIFIER_TOO_MANY", `Trop de choix pour : ${g.name}`);
    for (const s of chosen) {
      const m = g.modifiers.find((x) => x.id === s.modifierId)!;
      if (!m.isAvailable) throw new ApiError(409, "MODIFIER_UNAVAILABLE", `Option indisponible : ${m.name}`);
      result.push({ modifierId: m.id, groupName: g.name, name: m.name, priceDelta: m.priceDelta, quantity: s.quantity ?? 1 });
    }
  }
  const known = new Set(groups.flatMap((g) => g.modifierGroup.modifiers.map((m) => m.id)));
  for (const s of selections) if (!known.has(s.modifierId)) throw new ApiError(400, "BAD_MODIFIER", "Option invalide pour ce produit");
  return result;
}

export async function addItem(actor: Actor, orderId: string, input: AddItemInput) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  const qty = Math.max(1, Math.floor(input.quantity ?? 1));
  if (input.courseId && !order.courses.some((c) => c.id === input.courseId)) throw new ApiError(400, "BAD_COURSE", "Service invalide");
  const courseId = input.courseId ?? order.courses[order.courses.length > 1 ? 2 : 0]?.id ?? null;

  await prisma.$transaction(async (tx) => {
    if (input.id && (await tx.orderItem.findUnique({ where: { id: input.id } }))) return; // rejeu idempotent
    const sortOrder = order.items.length;
    if (input.menuId) {
      const menu = await tx.menu.findFirst({ where: { id: input.menuId, establishmentId: actor.establishmentId, isActive: true }, include: { taxRate: true, sections: { include: { items: { include: { product: { include: { taxRate: true } } } } } } } });
      if (!menu) throw new ApiError(404, "NOT_FOUND", "Formule introuvable");
      const selections = input.menuSelections ?? [];
      for (const s of menu.sections) {
        const picked = selections.filter((x) => x.sectionId === s.id);
        if (picked.length < s.minSelect) throw new ApiError(400, "MENU_CHOICE_REQUIRED", `Choix obligatoire : ${s.name}`);
        if (picked.length > s.maxSelect) throw new ApiError(400, "MENU_TOO_MANY", `Trop de choix : ${s.name}`);
        for (const p of picked) if (!s.items.some((it) => it.productId === p.productId)) throw new ApiError(400, "BAD_MENU_PRODUCT", "Produit hors formule");
      }
      const parentCalc = computeLine({ quantity: qty, unitPrice: menu.priceTtc, modifiersTotal: 0, discountAmount: 0, taxRateBps: menu.taxRate?.rateBps ?? 0 });
      const parent = await tx.orderItem.create({
        data: {
          id: input.id, orderId, courseId, menuId: menu.id, name: menu.name, quantity: qty, unitPrice: menu.priceTtc, lineTotal: parentCalc.lineTotal,
          taxRateBps: menu.taxRate?.rateBps ?? 0, taxRateName: menu.taxRate?.name ?? null, taxAmount: parentCalc.taxAmount, seatNumber: input.seatNumber ?? null,
          notes: input.notes ?? null, isUrgent: input.isUrgent ?? false, sortOrder,
        },
      });
      let costTotal = 0;
      for (const sel of selections) {
        const section = menu.sections.find((s) => s.id === sel.sectionId)!;
        const mi = section.items.find((it) => it.productId === sel.productId)!;
        if (!mi.product.isAvailable || !mi.product.isActive) throw new ApiError(409, "PRODUCT_UNAVAILABLE", `Indisponible : ${mi.product.name}`);
        const mods = await resolveModifiers(tx, mi.productId, sel.modifiers ?? []);
        const modifiersTotal = mods.reduce((a, m) => a + m.priceDelta * m.quantity, 0);
        const calc = computeLine({ quantity: qty, unitPrice: mi.supplement, modifiersTotal, discountAmount: 0, taxRateBps: mi.product.taxRate?.rateBps ?? 0 });
        costTotal += mi.product.costPrice;
        await tx.orderItem.create({
          data: {
            orderId, courseId, parentItemId: parent.id, productId: mi.productId, kitchenStationId: mi.product.kitchenStationId, name: mi.product.name, quantity: qty,
            unitPrice: mi.supplement, modifiersTotal, lineTotal: calc.lineTotal, taxRateBps: mi.product.taxRate?.rateBps ?? 0, taxRateName: mi.product.taxRate?.name ?? null,
            taxAmount: calc.taxAmount, costPrice: mi.product.costPrice, seatNumber: input.seatNumber ?? null, isUrgent: input.isUrgent ?? false, sortOrder,
            modifiers: { create: mods.map((m) => ({ modifierId: m.modifierId, groupName: m.groupName, name: m.name, priceDelta: m.priceDelta, quantity: m.quantity })) },
          },
        });
      }
      await tx.orderItem.update({ where: { id: parent.id }, data: { costPrice: costTotal } });
    } else {
      if (!input.productId) throw new ApiError(400, "BAD_ITEM", "productId ou menuId requis");
      const product = await tx.product.findFirst({ where: { id: input.productId, establishmentId: actor.establishmentId, isActive: true }, include: { taxRate: true, variants: true } });
      if (!product) throw new ApiError(404, "NOT_FOUND", "Produit introuvable");
      if (!product.isAvailable || product.autoUnavailable) throw new ApiError(409, "PRODUCT_UNAVAILABLE", `Indisponible : ${product.name}`);
      const variant = input.variantId ? product.variants.find((v) => v.id === input.variantId) : null;
      if (input.variantId && !variant) throw new ApiError(400, "BAD_VARIANT", "Variante invalide");
      const mods = await resolveModifiers(tx, product.id, input.modifiers ?? []);
      const modifiersTotal = mods.reduce((a, m) => a + m.priceDelta * m.quantity, 0);
      const unitPrice = variant ? variant.priceTtc : product.priceTtc;
      const calc = computeLine({ quantity: qty, unitPrice, modifiersTotal, discountAmount: 0, taxRateBps: product.taxRate?.rateBps ?? 0 });
      await tx.orderItem.create({
        data: {
          id: input.id, orderId, courseId, productId: product.id, variantId: variant?.id ?? null, kitchenStationId: product.kitchenStationId,
          name: variant ? `${product.name} (${variant.name})` : product.name, quantity: qty, unitPrice, modifiersTotal, lineTotal: calc.lineTotal,
          taxRateBps: product.taxRate?.rateBps ?? 0, taxRateName: product.taxRate?.name ?? null, taxAmount: calc.taxAmount, costPrice: product.costPrice,
          seatNumber: input.seatNumber ?? null, notes: input.notes ?? null, isUrgent: input.isUrgent ?? false, sortOrder,
          modifiers: { create: mods.map((m) => ({ modifierId: m.modifierId, groupName: m.groupName, name: m.name, priceDelta: m.priceDelta, quantity: m.quantity })) },
        },
      });
    }
    await recalcOrder(tx, orderId);
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  return getOrder(actor.establishmentId, orderId);
}

export async function updateItem(actor: Actor, orderId: string, itemId: string, input: { quantity?: number; seatNumber?: number | null; notes?: string | null; courseId?: string | null; isUrgent?: boolean }) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  const item = order.items.find((i) => i.id === itemId);
  if (!item) throw new ApiError(404, "NOT_FOUND", "Article introuvable");
  if (input.quantity !== undefined && item.status !== "PENDING") throw new ApiError(409, "ITEM_SENT", "Article déjà envoyé : utilisez la suppression avec motif");
  if (input.courseId && !order.courses.some((c) => c.id === input.courseId)) throw new ApiError(400, "BAD_COURSE", "Service invalide");
  await prisma.$transaction(async (tx) => {
    const qty = input.quantity !== undefined ? Math.max(1, Math.floor(input.quantity)) : item.quantity;
    const calc = computeLine({ quantity: qty, unitPrice: item.unitPrice, modifiersTotal: item.modifiersTotal, discountAmount: item.discountAmount, taxRateBps: item.taxRateBps });
    const targets = [item.id, ...order.items.filter((i) => i.parentItemId === item.id).map((i) => i.id)];
    for (const id of targets) {
      const it = order.items.find((i) => i.id === id)!;
      const c = computeLine({ quantity: qty, unitPrice: it.unitPrice, modifiersTotal: it.modifiersTotal, discountAmount: it.discountAmount, taxRateBps: it.taxRateBps });
      await tx.orderItem.update({
        where: { id },
        data: { quantity: qty, lineTotal: id === item.id ? calc.lineTotal : c.lineTotal, taxAmount: id === item.id ? calc.taxAmount : c.taxAmount, seatNumber: input.seatNumber, notes: id === item.id ? input.notes : undefined, courseId: input.courseId, isUrgent: input.isUrgent },
      });
    }
    await recalcOrder(tx, orderId);
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  return getOrder(actor.establishmentId, orderId);
}

/** Suppression d'un article : simple retrait si non envoyé, sinon annulation tracée (permission pos.void_item). */
export async function removeItem(actor: Actor, orderId: string, itemId: string, reason?: string | null) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  const item = order.items.find((i) => i.id === itemId);
  if (!item) throw new ApiError(404, "NOT_FOUND", "Article introuvable");
  const wasSent = item.status !== "PENDING";
  await prisma.$transaction(async (tx) => {
    const targets = [item.id, ...order.items.filter((i) => i.parentItemId === item.id).map((i) => i.id)];
    if (wasSent) {
      await tx.orderItem.updateMany({ where: { id: { in: targets } }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason ?? null, lineTotal: 0, taxAmount: 0 } });
      await audit({ ...actor, action: "item.void", entityType: "order_item", entityId: item.id, oldValue: { name: item.name, quantity: item.quantity, lineTotal: item.lineTotal, orderNumber: order.number }, reason }, tx);
    } else {
      await tx.orderItem.deleteMany({ where: { id: { in: targets } } });
      await audit({ ...actor, action: "item.remove", entityType: "order_item", entityId: item.id, oldValue: { name: item.name, quantity: item.quantity, lineTotal: item.lineTotal, orderNumber: order.number }, reason }, tx);
    }
    await recalcOrder(tx, orderId);
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  if (wasSent) publish("kitchen.updated", actor.establishmentId, { orderId });
  return getOrder(actor.establishmentId, orderId);
}

// ---------------------------------------------------------------- Services / envoi cuisine
/** Envoie en cuisine les articles en attente d'un service (ou de toute la commande). Crée un ticket par poste. */
export async function sendCourse(actor: Actor, orderId: string, opts: { courseId?: string | null; all?: boolean }) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  const pending = order.items.filter((i) => i.status === "PENDING" && (opts.all || i.courseId === opts.courseId));
  if (pending.length === 0) throw new ApiError(400, "NOTHING_TO_SEND", "Aucun article à envoyer");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Regroupement par (service, poste)
    const groups = new Map<string, typeof pending>();
    for (const item of pending) {
      if (item.menuId && !item.productId) continue; // le parent formule n'a pas de poste ; ses composants oui
      const key = `${item.courseId ?? "none"}|${item.kitchenStationId ?? "none"}`;
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    for (const [key, items] of groups) {
      const [courseId, stationId] = key.split("|");
      const ticket = await tx.kitchenTicket.create({
        data: { orderId, courseId: courseId === "none" ? null : courseId, stationId: stationId === "none" ? null : stationId, isUrgent: items.some((i) => i.isUrgent) },
      });
      await tx.orderItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { status: "SENT", sentAt: now, kitchenTicketId: ticket.id } });
    }
    await tx.orderItem.updateMany({ where: { id: { in: pending.map((i) => i.id) }, status: "PENDING" }, data: { status: "SENT", sentAt: now } });
    const courseIds = [...new Set(pending.map((i) => i.courseId).filter(Boolean))] as string[];
    await tx.course.updateMany({ where: { id: { in: courseIds } }, data: { status: "SENT", sentAt: now } });
    await tx.order.update({ where: { id: orderId }, data: { status: order.status === "OPEN" ? "SENT" : order.status, version: { increment: 1 } } });
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  publish("kitchen.updated", actor.establishmentId, { orderId });
  publish("table.updated", actor.establishmentId, { tableId: order.tableId });
  return getOrder(actor.establishmentId, orderId);
}

/** À suivre / Faire marcher / Ne pas envoyer : statut d'un service. */
export async function setCourseStatus(actor: Actor, orderId: string, courseId: string, status: Extract<CourseStatus, "PENDING" | "HOLD" | "FIRE" | "SERVED">) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  const course = order.courses.find((c) => c.id === courseId);
  if (!course) throw new ApiError(404, "NOT_FOUND", "Service introuvable");
  if (status === "FIRE" && course.status === "PENDING") {
    // "Faire marcher" un service non envoyé = envoi immédiat marqué urgent
    await prisma.orderItem.updateMany({ where: { orderId, courseId, status: "PENDING" }, data: { isUrgent: true } });
    await sendCourse(actor, orderId, { courseId });
  }
  await prisma.$transaction(async (tx) => {
    await tx.course.update({ where: { id: courseId }, data: { status, ...(status === "FIRE" ? { firedAt: new Date() } : {}) } });
    if (status === "FIRE") await tx.kitchenTicket.updateMany({ where: { courseId, status: { in: ["NEW", "ACCEPTED"] } }, data: { isUrgent: true } });
    if (status === "SERVED") await tx.orderItem.updateMany({ where: { courseId, status: { in: ["SENT", "PREPARING", "READY"] } }, data: { status: "SERVED", servedAt: new Date() } });
    await tx.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } });
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  publish("kitchen.updated", actor.establishmentId, { orderId });
  return getOrder(actor.establishmentId, orderId);
}

// ---------------------------------------------------------------- Remises, addition, annulation, transfert
export async function applyDiscount(actor: Actor, orderId: string, input: { amount?: number; percentBps?: number; reason: string }) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  const amount = input.percentBps !== undefined ? applyBps(order.subtotal, input.percentBps) : (input.amount ?? 0);
  if (amount < 0 || amount > order.subtotal) throw new ApiError(400, "BAD_DISCOUNT", "Remise invalide");
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { discountTotal: amount, discountReason: amount > 0 ? input.reason : null } });
    await recalcOrder(tx, orderId);
    await audit({ ...actor, action: "order.discount", entityType: "order", entityId: orderId, oldValue: { discountTotal: order.discountTotal }, newValue: { discountTotal: amount, percentBps: input.percentBps ?? null, orderNumber: order.number }, reason: input.reason }, tx);
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  return getOrder(actor.establishmentId, orderId);
}

export async function requestBill(actor: Actor, orderId: string) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  await prisma.order.update({ where: { id: orderId }, data: { status: "BILL_REQUESTED", billRequestedAt: new Date(), version: { increment: 1 } } });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  publish("table.updated", actor.establishmentId, { tableId: order.tableId });
  return getOrder(actor.establishmentId, orderId);
}

export async function cancelOrder(actor: Actor, orderId: string, reason: string) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  if (order.paidTotal > 0) throw new ApiError(409, "ORDER_PAID", "Remboursez les paiements avant d'annuler");
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED", cancelReason: reason, closedAt: new Date(), version: { increment: 1 } } });
    await tx.kitchenTicket.updateMany({ where: { orderId, status: { in: ["NEW", "ACCEPTED", "IN_PROGRESS"] } }, data: { status: "CANCELLED" } });
    await audit({ ...actor, action: "order.cancel", entityType: "order", entityId: orderId, oldValue: { status: order.status, total: order.total, number: order.number, items: order.items.length }, reason }, tx);
  });
  publish("order.closed", actor.establishmentId, { orderId, tableId: order.tableId });
  publish("table.updated", actor.establishmentId, { tableId: order.tableId });
  publish("kitchen.updated", actor.establishmentId, { orderId });
  return getOrder(actor.establishmentId, orderId);
}

export async function transferTable(actor: Actor, orderId: string, tableId: string) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  const table = await prisma.table.findFirst({ where: { id: tableId, establishmentId: actor.establishmentId, isActive: true } });
  if (!table) throw new ApiError(400, "BAD_TABLE", "Table invalide");
  const busy = await prisma.order.findFirst({ where: { tableId, status: { in: [...OPEN_STATUSES] }, id: { not: orderId } } });
  if (busy) throw new ApiError(409, "TABLE_BUSY", "La table de destination est occupée");
  const from = order.tableId;
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { tableId, type: "DINE_IN", version: { increment: 1 } } });
    await audit({ ...actor, action: "order.transfer", entityType: "order", entityId: orderId, oldValue: { tableId: from }, newValue: { tableId } }, tx);
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId });
  publish("table.updated", actor.establishmentId, { tableId: from });
  publish("table.updated", actor.establishmentId, { tableId });
  return getOrder(actor.establishmentId, orderId);
}

/** Clôture technique (appelée par le paiement lorsque le solde est atteint). */
export async function closeOrderIfPaid(tx: Tx, establishmentId: string, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status === "PAID" || order.status === "CANCELLED") return order;
  if (order.paidTotal < order.total) return order;
  const est = await tx.establishment.findUniqueOrThrow({ where: { id: establishmentId } });
  const settings = (est.settings ?? {}) as { markTablesToClean?: boolean };
  const closed = await tx.order.update({ where: { id: orderId }, data: { status: "PAID", closedAt: new Date(), version: { increment: 1 } } });
  await tx.orderItem.updateMany({ where: { orderId, status: { in: ["SENT", "PREPARING", "READY"] } }, data: { status: "SERVED", servedAt: new Date() } });
  await tx.kitchenTicket.updateMany({ where: { orderId, status: { in: ["NEW", "ACCEPTED", "IN_PROGRESS", "READY"] } }, data: { status: "DONE", completedAt: new Date() } });
  if (order.tableId) await tx.table.update({ where: { id: order.tableId }, data: { state: settings.markTablesToClean ? "TO_CLEAN" : "FREE" } });
  return closed;
}
