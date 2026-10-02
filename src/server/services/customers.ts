import { prisma, type Tx } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import type { Actor } from "./orders";

/**
 * Phase 6 — Clients et fidélité.
 * Programme configuré dans establishment.settings.loyalty :
 *   { enabled, pointsPer100: points gagnés par 100 F payés, rewardPoints: seuil, rewardValue: valeur en F d'une récompense }
 */
export type LoyaltySettings = { enabled: boolean; pointsPer100: number; rewardPoints: number; rewardValue: number };
export const DEFAULT_LOYALTY: LoyaltySettings = { enabled: false, pointsPer100: 1, rewardPoints: 100, rewardValue: 1000 };

export async function loyaltySettings(establishmentId: string): Promise<LoyaltySettings> {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { settings: true } });
  const s = ((est.settings ?? {}) as { loyalty?: Partial<LoyaltySettings> }).loyalty ?? {};
  return { ...DEFAULT_LOYALTY, ...s };
}

export async function listCustomers(organizationId: string, opts: { search?: string; take?: number; establishmentId?: string } = {}) {
  const q = opts.search?.trim();
  const rows = await prisma.customer.findMany({
    where: { organizationId, ...(q ? { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { email: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: [{ totalSpent: "desc" }, { lastName: "asc" }], take: opts.take ?? 100,
    include: { loyaltyAccounts: opts.establishmentId ? { where: { establishmentId: opts.establishmentId } } : true, _count: { select: { orders: true, reservations: true } } },
  });
  return rows.map((c) => ({ ...c, points: c.loyaltyAccounts.reduce((a, x) => a + x.points, 0) }));
}

export async function upsertCustomer(actor: Actor, input: { id?: string; firstName?: string | null; lastName?: string | null; phone?: string | null; email?: string | null; notes?: string | null; allergies?: string | null; birthday?: string | null; marketingConsent?: boolean }) {
  if (!input.firstName && !input.lastName && !input.phone && !input.email) throw new ApiError(400, "MISSING", "Indiquez au moins un nom, un téléphone ou un email");
  const data = {
    firstName: input.firstName ?? null, lastName: input.lastName ?? null, phone: input.phone ?? null, email: input.email?.toLowerCase() ?? null, notes: input.notes ?? null, allergies: input.allergies ?? null,
    ...(input.birthday !== undefined ? { birthday: input.birthday || null } : {}),
    // Accord pour les offres par e-mail : daté ; le redonner annule un désabonnement passé
    ...(input.marketingConsent === true ? { marketingConsent: true, consentAt: new Date(), unsubscribedAt: null } : input.marketingConsent === false ? { marketingConsent: false } : {}),
  };
  if (input.id) {
    const existing = await prisma.customer.findFirst({ where: { id: input.id, organizationId: actor.organizationId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Client introuvable");
    return prisma.customer.update({ where: { id: input.id }, data });
  }
  if (data.phone) {
    const dup = await prisma.customer.findFirst({ where: { organizationId: actor.organizationId, phone: data.phone } });
    if (dup) return prisma.customer.update({ where: { id: dup.id }, data: { ...data, firstName: data.firstName ?? dup.firstName, lastName: data.lastName ?? dup.lastName, email: data.email ?? dup.email, notes: data.notes ?? dup.notes, allergies: data.allergies ?? dup.allergies } });
  }
  const row = await prisma.customer.create({ data: { organizationId: actor.organizationId, ...data } });
  await audit({ ...actor, action: "customer.create", entityType: "customer", entityId: row.id, newValue: { phone: row.phone, name: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() } });
  return row;
}

/** Retrouve ou crée un client public (commande en ligne, réservation) par téléphone ou email. */
export async function findOrCreatePublicCustomer(tx: Tx, organizationId: string, input: { name: string; phone?: string | null; email?: string | null }) {
  const phone = input.phone?.replace(/\s+/g, "") || null;
  const email = input.email?.toLowerCase() || null;
  const existing = phone ? await tx.customer.findFirst({ where: { organizationId, phone } }) : email ? await tx.customer.findFirst({ where: { organizationId, email } }) : null;
  if (existing) return existing;
  const [firstName, ...rest] = input.name.trim().split(/\s+/);
  return tx.customer.create({ data: { organizationId, firstName, lastName: rest.join(" ") || null, phone, email } });
}

export async function attachCustomer(actor: Actor, orderId: string, customerId: string | null) {
  const order = await prisma.order.findFirst({ where: { id: orderId, establishmentId: actor.establishmentId } });
  if (!order) throw new ApiError(404, "NOT_FOUND", "Commande introuvable");
  if (customerId) {
    const c = await prisma.customer.findFirst({ where: { id: customerId, organizationId: actor.organizationId } });
    if (!c) throw new ApiError(404, "NOT_FOUND", "Client introuvable");
  }
  await prisma.order.update({ where: { id: orderId }, data: { customerId, version: { increment: 1 } } });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  return customerId ? getCustomerCard(actor.establishmentId, customerId) : null;
}

export async function getCustomerCard(establishmentId: string, customerId: string) {
  // Client de l'entreprise de l'établissement uniquement (pas de lecture d'une fiche d'un autre restaurant)
  const c = await prisma.customer.findFirst({ where: { id: customerId, organization: { establishments: { some: { id: establishmentId } } } }, include: { loyaltyAccounts: { where: { establishmentId }, include: { transactions: { orderBy: { createdAt: "desc" }, take: 20 } } } } });
  if (!c) throw new ApiError(404, "NOT_FOUND", "Client introuvable");
  const settings = await loyaltySettings(establishmentId);
  const account = c.loyaltyAccounts[0] ?? null;
  const points = account?.points ?? 0;
  return { ...c, loyaltyAccounts: undefined, points, rewardsAvailable: settings.enabled && settings.rewardPoints > 0 ? Math.floor(points / settings.rewardPoints) : 0, settings, transactions: account?.transactions ?? [] };
}

/** Points gagnés au paiement complet d'une commande liée à un client ; visites et dépenses cumulées. */
export async function earnLoyalty(tx: Tx, establishmentId: string, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { customerId: true, total: true, number: true, status: true, payments: { select: { method: true, amount: true, refundedAmount: true, status: true } } } });
  if (!order.customerId || order.status !== "PAID") return null;
  if (await tx.loyaltyTransaction.findFirst({ where: { orderId, points: { gt: 0 } } })) return null; // déjà crédité pour cette commande
  // Base : ce que le client a réellement payé (les paiements « Offert » ne rapportent ni points ni dépenses)
  const spent = order.payments.filter((p) => p.method !== "COMPLIMENTARY" && p.status !== "VOIDED").reduce((a, p) => a + p.amount - p.refundedAmount, 0);
  await tx.customer.update({ where: { id: order.customerId }, data: { visitCount: { increment: 1 }, totalSpent: { increment: spent } } });
  const est = await tx.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { settings: true } });
  const settings = { ...DEFAULT_LOYALTY, ...(((est.settings ?? {}) as { loyalty?: Partial<LoyaltySettings> }).loyalty ?? {}) };
  if (!settings.enabled) return null;
  const points = Math.floor(spent / 100) * settings.pointsPer100;
  if (points <= 0) return null;
  const account = await tx.loyaltyAccount.upsert({ where: { establishmentId_customerId: { establishmentId, customerId: order.customerId } }, update: { points: { increment: points } }, create: { establishmentId, customerId: order.customerId, points } });
  await tx.loyaltyTransaction.create({ data: { accountId: account.id, orderId, points, reason: `Commande ${order.number}` } });
  return { points, balance: account.points };
}

/** Utilise une récompense : remise sur la commande et débit des points (tracé). */
export async function redeemReward(actor: Actor, orderId: string, rewards = 1) {
  const order = await prisma.order.findFirst({ where: { id: orderId, establishmentId: actor.establishmentId } });
  if (!order) throw new ApiError(404, "NOT_FOUND", "Commande introuvable");
  if (!order.customerId) throw new ApiError(400, "NO_CUSTOMER", "Associez d'abord un client à la commande");
  if (order.status === "PAID" || order.status === "CANCELLED") throw new ApiError(409, "ORDER_CLOSED", "Commande clôturée");
  const settings = await loyaltySettings(actor.establishmentId);
  if (!settings.enabled) throw new ApiError(400, "LOYALTY_OFF", "Le programme de fidélité est désactivé");
  const account = await prisma.loyaltyAccount.findUnique({ where: { establishmentId_customerId: { establishmentId: actor.establishmentId, customerId: order.customerId } } });
  const needed = settings.rewardPoints * rewards;
  if (!account || account.points < needed) throw new ApiError(400, "NOT_ENOUGH_POINTS", `Points insuffisants (${account?.points ?? 0} / ${needed})`);
  const { lockOrder, recalcOrder, settleAfterChange } = await import("./orders");
  let amount = 0;
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, subtotal: true, discountTotal: true, discountReason: true } });
    if (fresh.status === "PAID" || fresh.status === "CANCELLED") throw new ApiError(409, "ORDER_CLOSED", "Commande clôturée");
    // La récompense s'AJOUTE à la remise existante, dans la limite de ce qui reste à remiser
    amount = Math.min(fresh.subtotal - fresh.discountTotal, settings.rewardValue * rewards);
    if (amount <= 0) throw new ApiError(400, "NOTHING_TO_DISCOUNT", "Rien à déduire sur cette commande");
    // Débit conditionnel : deux utilisations simultanées ne rendent jamais le solde négatif
    const debit = await tx.loyaltyAccount.updateMany({ where: { id: account.id, points: { gte: needed } }, data: { points: { decrement: needed } } });
    if (debit.count === 0) throw new ApiError(400, "NOT_ENOUGH_POINTS", "Points insuffisants");
    await tx.loyaltyTransaction.create({ data: { accountId: account.id, orderId, points: -needed, reason: `Récompense sur ${order.number}` } });
    await tx.order.update({ where: { id: orderId }, data: { discountTotal: fresh.discountTotal + amount, discountReason: [fresh.discountReason, `Fidélité (${needed} pts)`].filter(Boolean).join(" + ") } });
    await recalcOrder(tx, orderId);
    await audit({ ...actor, action: "loyalty.redeem", entityType: "order", entityId: orderId, newValue: { points: needed, amount, customerId: order.customerId } }, tx);
    await settleAfterChange(tx, actor, orderId, { closeIfZero: true });
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  return { amount, points: needed };
}

export async function adjustPoints(actor: Actor, customerId: string, points: number, reason: string) {
  const c = await prisma.customer.findFirst({ where: { id: customerId, organizationId: actor.organizationId } });
  if (!c) throw new ApiError(404, "NOT_FOUND", "Client introuvable");
  await prisma.$transaction(async (tx) => {
    const account = await tx.loyaltyAccount.upsert({ where: { establishmentId_customerId: { establishmentId: actor.establishmentId, customerId } }, update: {}, create: { establishmentId: actor.establishmentId, customerId, points: 0 } });
    // Jamais de solde négatif : un retrait supérieur au solde est refusé
    const upd = await tx.loyaltyAccount.updateMany({ where: { id: account.id, ...(points < 0 ? { points: { gte: -points } } : {}) }, data: { points: { increment: points } } });
    if (upd.count === 0) throw new ApiError(400, "NOT_ENOUGH_POINTS", `Solde insuffisant (${account.points} points)`);
    await tx.loyaltyTransaction.create({ data: { accountId: account.id, points, reason } });
    await audit({ ...actor, action: "loyalty.adjust", entityType: "customer", entityId: customerId, newValue: { points, balance: account.points + points }, reason }, tx);
  });
  return getCustomerCard(actor.establishmentId, customerId);
}
