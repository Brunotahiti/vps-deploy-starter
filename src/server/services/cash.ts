import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import type { CashMovementKind } from "@/generated/prisma/client";
import type { Actor } from "./orders";

export async function findOpenSession(establishmentId: string, terminalId: string | null) {
  const sessions = await prisma.cashSession.findMany({ where: { establishmentId, status: "OPEN" }, orderBy: { openedAt: "desc" } });
  return sessions.find((s) => s.terminalId === terminalId) ?? sessions.find((s) => s.terminalId === null) ?? sessions[0] ?? null;
}

export async function openSession(actor: Actor, input: { openingFloat: number; notes?: string | null }) {
  const existing = await prisma.cashSession.findFirst({ where: { establishmentId: actor.establishmentId, status: "OPEN", terminalId: actor.terminalId ?? null } });
  if (existing) throw new ApiError(409, "ALREADY_OPEN", "Une session de caisse est déjà ouverte sur ce terminal");
  if (!Number.isInteger(input.openingFloat) || input.openingFloat < 0) throw new ApiError(400, "BAD_AMOUNT", "Fond de caisse invalide");
  const session = await prisma.$transaction(async (tx) => {
    const s = await tx.cashSession.create({ data: { establishmentId: actor.establishmentId, terminalId: actor.terminalId ?? null, openedById: actor.userId, openingFloat: input.openingFloat, notes: input.notes ?? null } });
    await tx.cashMovement.create({ data: { cashSessionId: s.id, userId: actor.userId, kind: "OPENING", amount: input.openingFloat, reason: "Fond de caisse" } });
    await audit({ ...actor, action: "cash.open", entityType: "cash_session", entityId: s.id, newValue: { openingFloat: input.openingFloat } }, tx);
    return s;
  });
  publish("cash.updated", actor.establishmentId, { cashSessionId: session.id });
  return getSessionReport(actor.establishmentId, session.id);
}

export async function addMovement(actor: Actor, sessionId: string, input: { kind: Extract<CashMovementKind, "PAY_IN" | "PAY_OUT" | "DEPOSIT" | "CORRECTION">; amount: number; reason: string }) {
  const session = await prisma.cashSession.findFirst({ where: { id: sessionId, establishmentId: actor.establishmentId } });
  if (!session) throw new ApiError(404, "NOT_FOUND", "Session introuvable");
  if (session.status !== "OPEN" && input.kind !== "CORRECTION") throw new ApiError(409, "SESSION_CLOSED", "Session clôturée");
  if (!Number.isInteger(input.amount) || input.amount === 0) throw new ApiError(400, "BAD_AMOUNT", "Montant invalide");
  const signed = input.kind === "PAY_IN" ? Math.abs(input.amount) : input.kind === "CORRECTION" ? input.amount : -Math.abs(input.amount);
  await prisma.$transaction(async (tx) => {
    const m = await tx.cashMovement.create({ data: { cashSessionId: sessionId, userId: actor.userId, kind: input.kind, amount: signed, reason: input.reason } });
    await audit({ ...actor, action: `cash.${input.kind.toLowerCase()}`, entityType: "cash_movement", entityId: m.id, newValue: { amount: signed, kind: input.kind }, reason: input.reason }, tx);
    if (session.status === "CLOSED") {
      // Correction post-clôture : recalcul de l'écart, tracé
      const expected = (session.expectedCash ?? 0) + signed;
      await tx.cashSession.update({ where: { id: sessionId }, data: { expectedCash: expected, difference: (session.countedCash ?? 0) - expected } });
      await audit({ ...actor, action: "cash.closing_correction", entityType: "cash_session", entityId: sessionId, oldValue: { expectedCash: session.expectedCash, difference: session.difference }, newValue: { expectedCash: expected, difference: (session.countedCash ?? 0) - expected }, reason: input.reason }, tx);
    }
  });
  publish("cash.updated", actor.establishmentId, { cashSessionId: sessionId });
  return getSessionReport(actor.establishmentId, sessionId);
}

export async function closeSession(actor: Actor, sessionId: string, input: { countedCash: number; notes?: string | null }) {
  const session = await prisma.cashSession.findFirst({ where: { id: sessionId, establishmentId: actor.establishmentId }, include: { movements: true } });
  if (!session) throw new ApiError(404, "NOT_FOUND", "Session introuvable");
  if (session.status !== "OPEN") throw new ApiError(409, "SESSION_CLOSED", "Session déjà clôturée");
  if (!Number.isInteger(input.countedCash) || input.countedCash < 0) throw new ApiError(400, "BAD_AMOUNT", "Montant compté invalide");
  const expected = session.movements.reduce((a, m) => a + m.amount, 0);
  const difference = input.countedCash - expected;
  await prisma.$transaction(async (tx) => {
    await tx.cashMovement.create({ data: { cashSessionId: sessionId, userId: actor.userId, kind: "CLOSING", amount: 0, reason: `Clôture — compté ${input.countedCash}` } });
    await tx.cashSession.update({ where: { id: sessionId }, data: { status: "CLOSED", closedAt: new Date(), closedById: actor.userId, expectedCash: expected, countedCash: input.countedCash, difference, notes: input.notes ?? session.notes } });
    await audit({ ...actor, action: "cash.close", entityType: "cash_session", entityId: sessionId, newValue: { expectedCash: expected, countedCash: input.countedCash, difference } }, tx);
  });
  publish("cash.updated", actor.establishmentId, { cashSessionId: sessionId });
  return getSessionReport(actor.establishmentId, sessionId);
}

/** Rapport de session (X en cours / Z après clôture) : espèces, ventes par moyen de paiement, mouvements. */
export async function getSessionReport(establishmentId: string, sessionId: string) {
  const session = await prisma.cashSession.findFirst({
    where: { id: sessionId, establishmentId },
    include: {
      openedBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      closedBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      terminal: { select: { id: true, name: true } },
      movements: { orderBy: { createdAt: "asc" }, include: { user: { select: { firstName: true, lastName: true, displayName: true } } } },
      payments: { include: { refunds: true } },
    },
  });
  if (!session) throw new ApiError(404, "NOT_FOUND", "Session introuvable");
  const byMethod: Record<string, { count: number; amount: number; tips: number; refunded: number }> = {};
  for (const p of session.payments) {
    const e = (byMethod[p.method] ??= { count: 0, amount: 0, tips: 0, refunded: 0 });
    e.count++; e.amount += p.amount; e.tips += p.tipAmount; e.refunded += p.refundedAmount;
  }
  const cashExpected = session.status === "CLOSED" ? session.expectedCash! : session.movements.reduce((a, m) => a + m.amount, 0);
  const sum = (kinds: CashMovementKind[]) => session.movements.filter((m) => kinds.includes(m.kind)).reduce((a, m) => a + m.amount, 0);
  return {
    session,
    summary: {
      openingFloat: session.openingFloat,
      cashSales: sum(["SALE"]),
      cashRefunds: sum(["REFUND"]),
      payIns: sum(["PAY_IN"]),
      payOuts: sum(["PAY_OUT"]),
      deposits: sum(["DEPOSIT"]),
      corrections: sum(["CORRECTION"]),
      cashExpected,
      countedCash: session.countedCash,
      difference: session.difference,
      byMethod,
      totalSales: session.payments.reduce((a, p) => a + p.amount - p.refundedAmount, 0),
      totalTips: session.payments.reduce((a, p) => a + p.tipAmount, 0),
      paymentsCount: session.payments.length,
    },
  };
}

export async function listSessions(establishmentId: string, take = 30) {
  return prisma.cashSession.findMany({
    where: { establishmentId }, orderBy: { openedAt: "desc" }, take,
    include: { openedBy: { select: { firstName: true, lastName: true, displayName: true } }, closedBy: { select: { firstName: true, lastName: true, displayName: true } }, terminal: { select: { name: true } } },
  });
}
