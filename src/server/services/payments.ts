import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import type { PaymentMethod } from "@/generated/prisma/client";
import { closeOrderIfPaid, getOrder, recalcOrder, type Actor } from "./orders";
import { findOpenSession } from "./cash";
import { earnLoyalty } from "./customers";

export type PaymentInput = {
  id?: string;
  method: PaymentMethod;
  amount: number;       // montant imputé à l'addition
  tendered?: number;    // espèces reçues (≥ amount)
  reference?: string | null;
  splitLabel?: string | null;
};

/** Enregistre un ou plusieurs paiements (multi-moyens) et clôture la commande si soldée. */
export async function addPayments(actor: Actor, orderId: string, inputs: PaymentInput[]) {
  const order = await getOrder(actor.establishmentId, orderId);
  if (order.status === "CANCELLED") throw new ApiError(409, "ORDER_CANCELLED", "Commande annulée");
  if (order.status === "PAID") throw new ApiError(409, "ORDER_PAID", "Commande déjà soldée");
  if (order.items.filter((i) => i.status !== "VOIDED").length === 0) throw new ApiError(400, "EMPTY_ORDER", "Commande vide");
  const remaining = order.total - order.paidTotal;
  const sum = inputs.reduce((a, p) => a + p.amount, 0);
  if (inputs.some((p) => p.amount <= 0 || !Number.isInteger(p.amount))) throw new ApiError(400, "BAD_AMOUNT", "Montant invalide");
  if (sum > remaining) throw new ApiError(400, "OVERPAYMENT", `Le total des paiements (${sum}) dépasse le reste à payer (${remaining})`);

  const methods = await prisma.paymentMethodConfig.findMany({ where: { establishmentId: actor.establishmentId } });
  for (const p of inputs) {
    const cfg = methods.find((m) => m.method === p.method);
    if (cfg && !cfg.isEnabled) throw new ApiError(400, "METHOD_DISABLED", `Moyen de paiement désactivé : ${cfg.label}`);
  }
  const cashSession = await findOpenSession(actor.establishmentId, actor.terminalId ?? null);
  if (inputs.some((p) => p.method === "CASH") && !cashSession) throw new ApiError(409, "NO_CASH_SESSION", "Ouvrez une session de caisse avant d'encaisser des espèces");

  const created = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const p of inputs) {
      if (p.id && (await tx.payment.findUnique({ where: { id: p.id } }))) continue; // rejeu idempotent
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
          reference: p.reference ?? null, splitLabel: p.splitLabel ?? null,
        },
      });
      if (p.method === "CASH" && cashSession) {
        await tx.cashMovement.create({ data: { cashSessionId: cashSession.id, userId: actor.userId, paymentId: payment.id, orderId, kind: "SALE", amount: p.amount + tip, reason: `Vente ${order.number}` } });
      }
      if (p.method === "COMPLIMENTARY") {
        await audit({ ...actor, action: "payment.complimentary", entityType: "payment", entityId: payment.id, newValue: { amount: p.amount, orderNumber: order.number } }, tx);
      }
      out.push(payment);
    }
    await recalcOrder(tx, orderId);
    await closeOrderIfPaid(tx, actor.establishmentId, orderId);
    await earnLoyalty(tx, actor.establishmentId, orderId); // Phase 6 : points de fidélité, visites, dépenses
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
  const refundable = payment.amount - payment.refundedAmount;
  if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > refundable) throw new ApiError(400, "BAD_AMOUNT", `Montant remboursable : ${refundable}`);
  const cashSession = payment.method === "CASH" ? await findOpenSession(actor.establishmentId, actor.terminalId ?? null) : null;
  if (payment.method === "CASH" && !cashSession) throw new ApiError(409, "NO_CASH_SESSION", "Ouvrez une session de caisse pour rembourser en espèces");
  await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.create({ data: { paymentId, issuedById: actor.userId, amount: input.amount, reason: input.reason } });
    const newRefunded = payment.refundedAmount + input.amount;
    await tx.payment.update({ where: { id: paymentId }, data: { refundedAmount: newRefunded, status: newRefunded >= payment.amount ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    if (cashSession) await tx.cashMovement.create({ data: { cashSessionId: cashSession.id, userId: actor.userId, paymentId, orderId: payment.orderId, kind: "REFUND", amount: -input.amount, reason: input.reason } });
    await recalcOrder(tx, payment.orderId);
    await audit({ ...actor, action: "payment.refund", entityType: "payment", entityId: paymentId, newValue: { refundId: refund.id, amount: input.amount, method: payment.method, orderNumber: payment.order.number }, reason: input.reason }, tx);
  });
  publish("order.updated", actor.establishmentId, { orderId: payment.orderId });
  if (cashSession) publish("cash.updated", actor.establishmentId, { cashSessionId: cashSession.id });
  return getOrder(actor.establishmentId, payment.orderId);
}
