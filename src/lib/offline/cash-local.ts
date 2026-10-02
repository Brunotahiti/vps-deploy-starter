"use client";

/**
 * Caisse sans internet : la tablette tient sa propre copie de la session de caisse (fond, ventes, mouvements)
 * pour afficher les espèces théoriques et clôturer pendant une coupure. Les opérations partent en file d'attente ;
 * au retour du réseau le serveur refait le calcul et sa version remplace la copie locale.
 */
import { useQuery } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/api-client";
import type { SessionReport } from "@/components/pos/types";
import { cacheGet, cacheSet } from "./db";
import { outbox } from "./outbox";

const KEY = "cash-current";
type Stored = { report: SessionReport | null; pendingLocal: boolean };
type Movement = SessionReport["session"]["movements"][number];

const isNetwork = (e: unknown) => e instanceof ApiClientError && (e.isNetwork || e.code === "OFFLINE" || e.code === "QUEUED");

/** Recalcule le résumé à partir des mouvements et des encaissements (même logique que le serveur). */
export function summarize(report: SessionReport): SessionReport {
  const ms = report.session.movements;
  const sum = (kinds: string[]) => ms.filter((m) => kinds.includes(m.kind)).reduce((a, m) => a + m.amount, 0);
  const pays = report.session.payments;
  const byMethod: SessionReport["summary"]["byMethod"] = {};
  for (const p of pays) { const e = (byMethod[p.method] ??= { count: 0, amount: 0, tips: 0, refunded: 0 }); e.count++; e.amount += p.amount; e.tips += p.tipAmount; e.refunded += p.refundedAmount; }
  return {
    ...report,
    summary: {
      ...report.summary,
      openingFloat: report.session.openingFloat,
      cashSales: sum(["SALE"]), cashRefunds: sum(["REFUND"]), payIns: sum(["PAY_IN"]), payOuts: sum(["PAY_OUT"]), deposits: sum(["DEPOSIT"]), corrections: sum(["CORRECTION"]),
      cashExpected: ms.reduce((a, m) => a + m.amount, 0),
      byMethod,
      totalSales: pays.reduce((a, p) => a + p.amount - p.refundedAmount, 0),
      totalTips: pays.reduce((a, p) => a + p.tipAmount, 0),
      paymentsCount: pays.length,
    },
  };
}

async function read() { return (await cacheGet<Stored>(KEY))?.data ?? null; }
async function write(report: SessionReport | null, pendingLocal: boolean) { await cacheSet(KEY, { report, pendingLocal } satisfies Stored); return report; }

/**
 * Session de caisse en cours : celle du serveur, sauf pendant une coupure ou tant que des opérations
 * faites hors ligne attendent d'être transmises (la copie locale est alors plus à jour).
 */
export async function loadCashCurrent(): Promise<SessionReport | null> {
  const local = await read().catch(() => null);
  try {
    const server = await api.get<SessionReport | null>("/api/cash/current");
    if (local?.pendingLocal && (await outbox.count()) > 0) return local.report;
    return write(server, false);
  } catch (e) {
    if (isNetwork(e) && local) return local.report;
    throw e;
  }
}

export function useCashCurrent(enabled = true) {
  return useQuery({ queryKey: ["cash", "current"], queryFn: loadCashCurrent, enabled });
}

/** Applique une opération faite hors ligne à la copie locale. */
async function patch(fn: (r: SessionReport | null) => SessionReport | null) {
  const cur = (await read())?.report ?? null;
  const next = fn(cur);
  return write(next ? summarize(next) : null, true);
}

const movement = (kind: string, amount: number, reason: string, userName: string): Movement =>
  ({ id: crypto.randomUUID(), cashSessionId: "", userId: null, paymentId: null, orderId: null, kind, amount, reason, createdAt: new Date(), user: { firstName: userName, lastName: "", displayName: null } }) as unknown as Movement;

export function openCashLocal(id: string, openingFloat: number, userName: string) {
  return patch(() => ({
    session: { id, status: "OPEN", openedAt: new Date(), openingFloat, movements: [movement("OPENING", openingFloat, "Fond de caisse", userName)], payments: [], terminal: null, openedBy: { firstName: userName, lastName: "", displayName: null } },
    summary: {},
  }) as unknown as SessionReport);
}

export function addCashMovementLocal(kind: "PAY_IN" | "PAY_OUT" | "DEPOSIT" | "CORRECTION", amount: number, reason: string, userName: string) {
  const signed = kind === "PAY_OUT" || kind === "DEPOSIT" ? -Math.abs(amount) : kind === "PAY_IN" ? Math.abs(amount) : amount;
  return patch((r) => (r ? { ...r, session: { ...r.session, movements: [...r.session.movements, movement(kind, signed, reason, userName)] } } : r));
}

/** Encaissement fait hors ligne : vente comptée dans la caisse ouverte sur cette tablette (espèces : mouvement de vente). */
export function addSaleLocal(payments: { method: string; amount: number }[], orderNumber: string, userName: string) {
  return patch((r) => {
    if (!r) return r;
    const pays = payments.map((p) => ({ id: crypto.randomUUID(), method: p.method, amount: p.amount, tipAmount: 0, refundedAmount: 0, refunds: [] })) as unknown as SessionReport["session"]["payments"];
    const sales = payments.filter((p) => p.method === "CASH").map((p) => movement("SALE", p.amount, `Vente ${orderNumber}`, userName));
    return { ...r, session: { ...r.session, payments: [...r.session.payments, ...pays], movements: [...r.session.movements, ...sales] } };
  });
}

/** Clôture hors ligne : écart calculé sur la tablette ; le serveur refait le calcul au retour du réseau. */
export async function closeCashLocal(countedCash: number) {
  const cur = (await read())?.report ?? null;
  const expected = cur ? summarize(cur).summary.cashExpected : 0;
  await write(null, true);
  return { expected, difference: countedCash - expected };
}

/** File vidée : la version du serveur fait de nouveau foi. */
export async function clearCashLocal() {
  const local = await read().catch(() => null);
  if (local?.pendingLocal) await cacheSet(KEY, { report: local.report, pendingLocal: false } satisfies Stored);
}
