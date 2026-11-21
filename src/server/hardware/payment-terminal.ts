import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/services/orders";
import type { PaymentTerminalAdapter } from "./adapter";
import http from "node:http";
import https from "node:https";
import { assertPublicUrlShape, publicOnlyLookup } from "@/server/net/public-url";

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

/**
 * Appel de la passerelle TPE depuis le serveur : jamais vers une adresse interne (réseau du serveur, services voisins,
 * métadonnées du cloud), vérifiée à la connexion même ; pas de redirection suivie ; réponse limitée à 64 Ko.
 * Sur un boîtier du restaurant (BOX_MODE), la passerelle est sur le réseau local : adresses privées permises.
 */
const safeFetch = ((input: string | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  const lan = process.env.BOX_MODE === "1";
  if (!lan) assertPublicUrlShape(u.toString());
  return new Promise<Response>((resolve, reject) => {
    const req = (u.protocol === "https:" ? https : http).request(u, { method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, lookup: lan ? undefined : publicOnlyLookup, signal: init?.signal ?? undefined }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => { size += c.length; if (size > 65_536) req.destroy(new Error("Réponse de la passerelle trop longue")); else chunks.push(c); });
      res.on("end", () => { const status = res.statusCode ?? 502; resolve(new Response([101, 204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status })); });
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(typeof init?.body === "string" ? init.body : undefined);
  });
}) as Fetcher;
let fetcher: Fetcher = safeFetch;
/** Pour les tests : remplace l'appel HTTP à la passerelle. */
export function setTerminalFetcher(f: Fetcher | null) { fetcher = f ?? safeFetch; }

/** Adresse d'un appel : l'adresse de la passerelle sans fragment ni paramètres, suivie du chemin de l'opération. */
function bridgeUrl(base: string, path: string) {
  const u = new URL(base);
  u.hash = "";
  u.search = "";
  u.pathname = u.pathname.replace(/\/+$/, "") + path;
  return u.toString();
}

export function bridgeAdapter(s: TerminalSettings): PaymentTerminalAdapter {
  const call = async (path: string, body: Record<string, unknown>) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), s.timeoutMs ?? 90_000);
    try {
      const res = await fetcher(bridgeUrl(s.url!, path), { method: "POST", headers: { "Content-Type": "application/json", ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}) }, body: JSON.stringify({ ...body, terminalId: s.terminalId ?? null }), signal: ctrl.signal });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; providerRef?: string; message?: string };
      if (!res.ok) return { ok: false, message: json.message ?? `Passerelle TPE : HTTP ${res.status}` };
      return { ok: !!json.ok, providerRef: json.providerRef, message: json.message };
    } catch (e) {
      // Message générique : le détail d'une erreur réseau ne doit pas renseigner sur ce qui écoute derrière une adresse
      if (e instanceof ApiError) return { ok: false, message: e.message };
      return { ok: false, message: (e as Error).name === "AbortError" ? "Délai TPE dépassé" : (e as { code?: string }).code === "EPRIVATE" ? "Adresse de la passerelle TPE refusée (adresse interne)" : "Passerelle TPE injoignable" };
    }
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
