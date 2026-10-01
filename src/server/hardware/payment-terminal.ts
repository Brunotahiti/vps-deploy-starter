import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/services/orders";
import type { PaymentTerminalAdapter } from "./adapter";

/**
 * Phase 7 — Terminal de paiement (TPE).
 * Adaptateurs :
 *  - manual : le serveur saisit le montant sur le TPE et note la référence (par défaut).
 *  - bridge : passerelle HTTP locale (ou du prestataire) : POST {amount, currency, reference} → {ok, providerRef}.
 *             Convient aux ponts TPE (Ingenico / Verifone via agent, OSB, prestataires monétiques).
 * Réglages : establishment.settings.payments.terminal = { adapter, url, apiKey?, terminalId?, timeoutMs? }
 */
export type TerminalSettings = { adapter: "manual" | "bridge"; url?: string; apiKey?: string; terminalId?: string; timeoutMs?: number };
export const DEFAULT_TERMINAL: TerminalSettings = { adapter: "manual" };

export async function terminalSettings(establishmentId: string): Promise<TerminalSettings> {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { settings: true } });
  const s = ((est.settings ?? {}) as { payments?: { terminal?: Partial<TerminalSettings> } }).payments?.terminal ?? {};
  return { ...DEFAULT_TERMINAL, ...s };
}

type Fetcher = typeof fetch;
let fetcher: Fetcher = fetch;
/** Pour les tests : remplace l'appel HTTP à la passerelle. */
export function setTerminalFetcher(f: Fetcher | null) { fetcher = f ?? fetch; }

export function bridgeAdapter(s: TerminalSettings): PaymentTerminalAdapter {
  const call = async (path: string, body: Record<string, unknown>) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), s.timeoutMs ?? 90_000);
    try {
      const res = await fetcher(`${s.url!.replace(/\/$/, "")}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}) }, body: JSON.stringify({ ...body, terminalId: s.terminalId ?? null }), signal: ctrl.signal });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; providerRef?: string; message?: string };
      if (!res.ok) return { ok: false, message: json.message ?? `Passerelle TPE : HTTP ${res.status}` };
      return { ok: !!json.ok, providerRef: json.providerRef, message: json.message };
    } catch (e) { return { ok: false, message: (e as Error).name === "AbortError" ? "Délai TPE dépassé" : (e as Error).message }; }
    finally { clearTimeout(t); }
  };
  return {
    provider: "bridge",
    charge: (amountMinor, currency, reference) => call("/charge", { amount: amountMinor, currency, reference }),
    refund: (providerRef, amountMinor) => call("/refund", { providerRef, amount: amountMinor }),
  };
}

/** Lance une transaction TPE pour une commande ; renvoie la référence à enregistrer avec le paiement. */
/**
 * Débit sur le TPE puis enregistrement du paiement dans la même requête : la caisse n'a plus à faire un second appel
 * (qui pouvait se perdre entre le débit de la carte et l'enregistrement). Si l'enregistrement échoue malgré tout,
 * la référence du TPE est tracée et renvoyée pour une saisie manuelle.
 */
export async function chargeOnTerminal(actor: Actor, orderId: string, amount: number, opts: { paymentId?: string; splitLabel?: string | null } = {}) {
  const s = await terminalSettings(actor.establishmentId);
  if (s.adapter !== "bridge" || !s.url) throw new ApiError(400, "NO_TERMINAL", "Aucun TPE connecté : saisissez le montant sur le terminal et notez la référence");
  const order = await prisma.order.findFirst({ where: { id: orderId, establishmentId: actor.establishmentId }, select: { number: true, total: true, paidTotal: true, status: true } });
  if (!order) throw new ApiError(404, "NOT_FOUND", "Commande introuvable");
  if (order.status === "PAID" || order.status === "CANCELLED") throw new ApiError(409, "ORDER_CLOSED", "Commande clôturée");
  if (amount <= 0 || amount > order.total - order.paidTotal) throw new ApiError(400, "BAD_AMOUNT", "Montant invalide");
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { currency: true } });
  const r = await bridgeAdapter(s).charge(amount, est.currency, order.number);
  await audit({ ...actor, action: "terminal.charge", entityType: "order", entityId: orderId, newValue: { amount, ok: r.ok, providerRef: r.providerRef ?? null, message: r.message ?? null } });
  if (!r.ok) throw new ApiError(402, "TERMINAL_DECLINED", r.message ?? "Paiement refusé par le TPE");
  const reference = r.providerRef ?? "TPE";
  try {
    const { addPayments } = await import("@/server/services/payments");
    const res = await addPayments(actor, orderId, [{ id: opts.paymentId ?? crypto.randomUUID(), method: "CARD", amount, reference, splitLabel: opts.splitLabel ?? null }]);
    return { providerRef: r.providerRef ?? null, amount, order: res.order, payments: res.payments };
  } catch (e) {
    const why = e instanceof ApiError ? e.message : "erreur inattendue";
    await audit({ ...actor, action: "terminal.charge_unrecorded", entityType: "order", entityId: orderId, newValue: { amount, providerRef: r.providerRef ?? null }, reason: why });
    throw new ApiError(409, "TERMINAL_PAID_NOT_RECORDED", `Carte débitée de ${amount} (réf. ${reference}) mais paiement non enregistré : ${why}. Enregistrez-le en « Carte » avec cette référence.`, { providerRef: r.providerRef ?? null, amount });
  }
}
