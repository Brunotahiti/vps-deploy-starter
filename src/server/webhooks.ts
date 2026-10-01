import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { assertPublicUrl, assertPublicUrlShape } from "@/server/net/public-url";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { setWebhookHook, REALTIME_EVENT_TYPES, type RealtimeEventType } from "@/server/realtime/bus";
import type { Actor } from "@/server/services/orders";

/**
 * Phase 7 — Webhooks sortants : à chaque événement métier, POST JSON signé (HMAC-SHA256 du corps,
 * en-tête X-ManaResto-Signature: sha256=<hex>) vers les URL abonnées, 3 tentatives (1 s, 5 s),
 * journal des livraisons, désactivation automatique après 20 échecs consécutifs.
 */
export const WEBHOOK_EVENTS = REALTIME_EVENT_TYPES;
const TIMEOUT_MS = 8_000;
const MAX_FAILURES = 20;

export function sign(secret: string, body: string) { return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`; }
export function verifySignature(secret: string, body: string, header: string | null) {
  if (!header) return false;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function listWebhooks(establishmentId: string) {
  const rows = await prisma.webhook.findMany({ where: { establishmentId }, orderBy: { createdAt: "asc" }, include: { deliveries: { orderBy: { createdAt: "desc" }, take: 5 } } });
  return rows.map(({ secret, ...w }) => ({ ...w, secretPreview: `${secret.slice(0, 6)}…` }));
}

export async function createWebhook(actor: Actor, input: { url: string; events: string[]; description?: string | null }) {
  assertPublicUrlShape(input.url);
  const events = input.events.includes("*") ? ["*"] : input.events.filter((e) => (WEBHOOK_EVENTS as string[]).includes(e));
  if (events.length === 0) throw new ApiError(400, "NO_EVENTS", "Choisissez au moins un événement");
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const row = await prisma.webhook.create({ data: { establishmentId: actor.establishmentId, url: input.url, secret, events, description: input.description ?? null } });
  await audit({ ...actor, action: "webhook.create", entityType: "webhook", entityId: row.id, newValue: { url: row.url, events } });
  return { ...row, secret }; // secret affiché une seule fois
}

export async function updateWebhook(actor: Actor, id: string, input: { url?: string; events?: string[]; description?: string | null; isActive?: boolean }) {
  const existing = await prisma.webhook.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Webhook introuvable");
  if (input.url !== undefined) assertPublicUrlShape(input.url);
  const events = input.events ? (input.events.includes("*") ? ["*"] : input.events.filter((e) => (WEBHOOK_EVENTS as string[]).includes(e))) : undefined;
  const row = await prisma.webhook.update({ where: { id }, data: { url: input.url, events, description: input.description, isActive: input.isActive, ...(input.isActive ? { failures: 0 } : {}) } });
  const { secret: _s, ...safe } = row;
  return safe;
}

export async function deleteWebhook(actor: Actor, id: string) {
  const existing = await prisma.webhook.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Webhook introuvable");
  await prisma.webhook.delete({ where: { id } });
  await audit({ ...actor, action: "webhook.delete", entityType: "webhook", entityId: id, oldValue: { url: existing.url } });
}

type Transport = (url: string, body: string, headers: Record<string, string>) => Promise<{ status: number; text: string }>;
let transport: Transport = async (url, body, headers) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    await assertPublicUrl(url); // résolution DNS au moment de l'appel : aucune adresse interne
    const res = await fetch(url, { method: "POST", body, headers, signal: ctrl.signal, redirect: "manual" });
    await res.body?.cancel().catch(() => {}); // le contenu de la réponse n'est ni lu ni renvoyé
    return { status: res.status, text: "" };
  }
  finally { clearTimeout(t); }
};
/** Pour les tests : remplace l'envoi HTTP. */
export function setWebhookTransport(t: Transport | null) { transport = t ?? transport; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Livre un événement à un webhook (3 tentatives) et journalise. */
export async function deliver(webhookId: string, event: string, payload: Record<string, unknown>) {
  const w = await prisma.webhook.findUnique({ where: { id: webhookId } });
  if (!w || !w.isActive) return null;
  const body = JSON.stringify({ id: randomBytes(12).toString("hex"), event, establishmentId: w.establishmentId, at: new Date().toISOString(), data: payload });
  const headers = { "Content-Type": "application/json", "User-Agent": "ManaResto-Webhooks/1.0", "X-ManaResto-Event": event, "X-ManaResto-Signature": sign(w.secret, body) };
  let status: number | null = null, error: string | null = null, attempts = 0;
  const started = Date.now();
  for (const delay of [0, 1000, 5000]) {
    if (delay) await sleep(delay);
    attempts++;
    try { const r = await transport(w.url, body, headers); status = r.status; if (r.status >= 200 && r.status < 300) { error = null; break; } error = `HTTP ${r.status}`; }
    catch (e) { error = (e as Error).message.slice(0, 300); status = null; }
  }
  const ok = status !== null && status >= 200 && status < 300;
  const delivery = await prisma.webhookDelivery.create({ data: { webhookId, event, payload: JSON.parse(body), status, error, attempts, durationMs: Date.now() - started } });
  const failures = ok ? 0 : w.failures + 1;
  await prisma.webhook.update({ where: { id: webhookId }, data: { lastStatus: status, lastError: error, lastAt: new Date(), failures, ...(failures >= MAX_FAILURES ? { isActive: false } : {}) } });
  await prisma.webhookDelivery.deleteMany({ where: { webhookId, createdAt: { lt: new Date(Date.now() - 7 * 86400_000) } } }).catch(() => {});
  return { ok, status, error, attempts, deliveryId: delivery.id };
}

/** Test manuel depuis l'administration : événement `ping`. */
export async function testWebhook(actor: Actor, id: string) {
  const w = await prisma.webhook.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!w) throw new ApiError(404, "NOT_FOUND", "Webhook introuvable");
  return deliver(id, "ping", { message: "Test ManaResto", at: new Date().toISOString() });
}

/** Diffusion asynchrone à tous les webhooks abonnés d'un établissement (jamais bloquant pour l'appelant). */
export function dispatch(type: RealtimeEventType, establishmentId: string, payload: Record<string, unknown>) {
  prisma.webhook.findMany({ where: { establishmentId, isActive: true }, select: { id: true, events: true } })
    .then((hooks) => { for (const h of hooks) if (h.events.includes("*") || h.events.includes(type)) deliver(h.id, type, payload).catch(() => {}); })
    .catch(() => {});
}
setWebhookHook(dispatch);
