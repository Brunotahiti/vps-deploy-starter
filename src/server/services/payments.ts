import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import type { PaymentMethod } from "@/generated/prisma/client";
import { closeOrderIfPaid, getOrder, lockOrder, recalcOrder, type Actor } from "./orders";
import { findOpenSession } from "./cash";
import { earnLoyalty } from "./customers";
import { assertAccountCharge, assertAccountsOption } from "./accounts";
import { assertMarketingOption, creditGiftCard, debitGiftCard, normalizeCode } from "./marketing";

export type PaymentInput = {
  id?: string;
  method: PaymentMethod;
  amount: number;       // montant imputé à l'addition
  tendered?: number;    // espèces reçues (≥ amount)
  reference?: string | null;
  splitLabel?: string | null;
  customerAccountId?: string | null; // « Sur compte » : compte du client pro à débiter
  giftCardCode?: string | null; // carte cadeau débitée
};

/** Enregistre un ou plusieurs paiements (multi-moyens) et clôture la commande si soldée. */
export async function addPayments(actor: Actor, orderId: string, inputs: PaymentInput[], opts: { offlineReplay?: boolean } = {}) {
  const order = await getOrder(actor.establishmentId, orderId);
  if (order.items.filter((i) => i.status !== "VOIDED").length === 0) throw new ApiError(400, "EMPTY_ORDER", "Commande vide");
  if (inputs.some((p) => p.amount <= 0 || !Number.isInteger(p.amount))) throw new ApiError(400, "BAD_AMOUNT", "Montant invalide");

  const methods = await prisma.paymentMethodConfig.findMany({ where: { establishmentId: actor.establishmentId } });
  for (const p of inputs) {
    const cfg = methods.find((m) => m.method === p.method);
    if (cfg && !cfg.isEnabled) throw new ApiError(400, "METHOD_DISABLED", `Moyen de paiement désactivé : ${cfg.label}`);
  }
  if (inputs.some((p) => p.method === "ACCOUNT") && !opts.offlineReplay) await assertAccountsOption(actor.organizationId);
  if (inputs.some((p) => p.method === "GIFT_CARD")) await assertMarketingOption(actor.organizationId);
  let cashSession: Awaited<ReturnType<typeof findOpenSession>> | null = await findOpenSession(actor.establishmentId, actor.terminalId ?? null);
  // Espèces encaissées hors ligne : l'argent est déjà dans le tiroir, le paiement ne doit jamais être refusé au retour du réseau.
  // Sans session ouverte, il reste « à rattacher » et rejoint la prochaine session ouverte (voir attachOfflineCashPayments).
  if (inputs.some((p) => p.method === "CASH") && !cashSession && !opts.offlineReplay) throw new ApiError(409, "NO_CASH_SESSION", "Ouvrez une session de caisse avant d'encaisser des espèces");

  const created = await prisma.$transaction(async (tx) => {
    // Contrôles SOUS VERROU : deux encaissements simultanés (deux tablettes, double appui) ne peuvent pas dépasser le reste dû
    await lockOrder(tx, orderId);
    const toCreate = [];
    for (const p of inputs) {
      if (p.id && (await tx.payment.findFirst({ where: { id: p.id, orderId } }))) continue; // rejeu idempotent
      toCreate.push(p);
    }
    if (toCreate.length === 0) return [];
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true, total: true, paidTotal: true } });
    if (fresh.status === "CANCELLED") throw new ApiError(409, "ORDER_CANCELLED", "Commande annulée");
    if (fresh.status === "PAID") throw new ApiError(409, "ORDER_PAID", "Commande déjà soldée");
    const remaining = fresh.total - fresh.paidTotal;
    const sum = toCreate.reduce((a, p) => a + p.amount, 0);
    if (sum > remaining) throw new ApiError(400, "OVERPAYMENT", `Le total des paiements (${sum}) dépasse le reste à payer (${remaining})`);
    if (cashSession && toCreate.some((p) => p.method === "CASH")) {
      await tx.$queryRaw`SELECT id FROM cash_sessions WHERE id = ${cashSession.id}::uuid FOR UPDATE`;
      const s = await tx.cashSession.findUnique({ where: { id: cashSession.id }, select: { status: true } });
      if (s?.status !== "OPEN") {
        if (!opts.offlineReplay) throw new ApiError(409, "NO_CASH_SESSION", "La session de caisse vient d'être clôturée : ouvrez-en une nouvelle");
        cashSession = null; // clôturée pendant la coupure : rattachée à la prochaine session
      }
    }
    // « Sur compte » : compte du bon établissement, ouvert, et plafond d'encours respecté (sous verrou du compte)
    for (const p of toCreate) if (p.method === "ACCOUNT") await assertAccountCharge(tx, actor, p.customerAccountId, p.amount, opts);
    // Carte cadeau : verrouillée, active, valide, solde suffisant ; le solde est débité ici
    const giftCards = new Map<PaymentInput, string>();
    for (const p of toCreate) if (p.method === "GIFT_CARD") giftCards.set(p, (await debitGiftCard(tx, actor, p.giftCardCode, p.amount)).id);
    const out = [];
    for (const p of toCreate) {
      const tip = 0; // pas de pourboires en Polynésie : le champ reste à zéro
      let changeGiven = 0;
      if (p.method === "CASH" && p.tendered !== undefined) {
        if (p.tendered < p.amount + tip) throw new ApiError(400, "INSUFFICIENT_CASH", "Espèces reçues insuffisantes");
        changeGiven = p.tendered - p.amount - tip;
      }
      const payment = await tx.payment.create({
        data: {
          id: p.id, establishmentId: actor.establishmentId, orderId, cashSessionId: cashSession?.id ?? null, receivedById: actor.userId,
          method: p.method, amount: p.amount, tipAmount: tip, tendered: p.method === "CASH" ? (p.tendered ?? p.amount + tip) : null, changeGiven,
          reference: p.reference ?? null, splitLabel: p.splitLabel ?? null, customerAccountId: p.method === "ACCOUNT" ? p.customerAccountId ?? null : null,
          giftCardId: giftCards.get(p) ?? null, ...(p.method === "GIFT_CARD" ? { reference: giftCards.has(p) ? normalizeCode(p.giftCardCode ?? "") : null } : {}),
        },
      });
      if (p.method === "CASH" && cashSession) {
        await tx.cashMovement.create({ data: { cashSessionId: cashSession.id, userId: actor.userId, paymentId: payment.id, orderId, kind: "SALE", amount: p.amount + tip, reason: `Vente ${order.number}` } });
      }
      if (p.method === "CASH" && !cashSession) {
        await audit({ ...actor, action: "payment.offline_unassigned", entityType: "payment", entityId: payment.id, newValue: { amount: p.amount, orderNumber: order.number } }, tx);
      }
      if (p.method === "COMPLIMENTARY") {
        await audit({ ...actor, action: "payment.complimentary", entityType: "payment", entityId: payment.id, newValue: { amount: p.amount, orderNumber: order.number } }, tx);
      }
      out.push(payment);
    }
    await recalcOrder(tx, orderId);
    const closed = await closeOrderIfPaid(tx, actor.establishmentId, orderId);
    if (closed.status === "PAID") await earnLoyalty(tx, actor.establishmentId, orderId); // une seule fois : à la clôture faite ici
    return out;
  });
  const updated = await getOrder(actor.establishmentId, orderId);
  publish("order.updated", actor.establishmentId, { orderId, tableId: updated.tableId });
  if (updated.status === "PAID") {
    publish("order.closed", actor.establishmentId, { orderId, tableId: updated.tableId });
    publish("table.updated", actor.establishmentId, { tableId: updated.tableId });
  }
  if (cashSession) publish("cash.updated", actor.establishmentId, { cashSessionId: cashSession.id });
  return { order: updated, payments: created };
}

export async function refundPayment(actor: Actor, paymentId: string, input: { amount: number; reason: string }) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, establishmentId: actor.establishmentId }, include: { order: true } });
  if (!payment) throw new ApiError(404, "NOT_FOUND", "Paiement introuvable");
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > payment.amount - payment.refundedAmount) throw new ApiError(400, "BAD_AMOUNT", `Montant remboursable : ${payment.amount - payment.refundedAmount}`);
  const cashSession = payment.method === "CASH" ? await findOpenSession(actor.establishmentId, actor.terminalId ?? null) : null;
  if (payment.method === "CASH" && !cashSession) throw new ApiError(409, "NO_CASH_SESSION", "Ouvrez une session de caisse pour rembourser en espèces");
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, payment.orderId);
    // Incrément conditionnel : deux remboursements simultanés ne peuvent pas dépasser le montant payé
    const upd = await tx.payment.updateMany({ where: { id: paymentId, refundedAmount: { lte: payment.amount - input.amount } }, data: { refundedAmount: { increment: input.amount } } });
    if (upd.count === 0) {
      const now = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { amount: true, refundedAmount: true } });
      throw new ApiError(400, "BAD_AMOUNT", `Montant remboursable : ${now.amount - now.refundedAmount}`);
    }
    const after = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { amount: true, refundedAmount: true } });
    await tx.payment.update({ where: { id: paymentId }, data: { status: after.refundedAmount >= after.amount ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    const refund = await tx.refund.create({ data: { paymentId, issuedById: actor.userId, amount: input.amount, reason: input.reason } });
    if (payment.method === "GIFT_CARD" && payment.giftCardId) await creditGiftCard(tx, payment.giftCardId, input.amount); // le montant revient sur la carte
    if (cashSession) await tx.cashMovement.create({ data: { cashSessionId: cashSession.id, userId: actor.userId, paymentId, orderId: payment.orderId, kind: "REFUND", amount: -input.amount, reason: input.reason } });
    await recalcOrder(tx, payment.orderId);
    await audit({ ...actor, action: "payment.refund", entityType: "payment", entityId: paymentId, newValue: { refundId: refund.id, amount: input.amount, method: payment.method, orderNumber: payment.order.number }, reason: input.reason }, tx);
  });
  publish("order.updated", actor.establishmentId, { orderId: payment.orderId });
  if (cashSession) publish("cash.updated", actor.establishmentId, { cashSessionId: cashSession.id });
  return getOrder(actor.establishmentId, payment.orderId);
}
