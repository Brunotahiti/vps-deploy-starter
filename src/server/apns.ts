import http2 from "node:http2";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import type { Actor } from "@/server/services/orders";

/**
 * Notifications de l'app iOS ManaResto par le service d'Apple (APNs, HTTP/2, jeton JWT signé ES256).
 * Clé d'authentification APNs (fichier .p8 du compte développeur Apple) dans l'environnement :
 * APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY (contenu du .p8, retours à la ligne en « \n » acceptés),
 * APNS_BUNDLE_ID (identifiant de l'app, com.manaresto.caisse par défaut). Sans elles : fonction indisponible.
 */
export type ApnsPayload = { aps: { alert: { title: string; body: string }; sound: string; "thread-id": string }; url: string; orderId: string | null };
export type ApnsMessage = { token: string; environment: string; payload: ApnsPayload; collapseId: string };
type SendResult = { ok: true } | { ok: false; gone: boolean; error: string };
type Transport = (message: ApnsMessage) => Promise<SendResult>;

/** Transport mémoire (tests, PUSH_TRANSPORT=memory) : notifications gardées ici au lieu d'être envoyées. */
export const sentApns: ApnsMessage[] = [];

export function apnsConfig() {
  const memory = process.env.PUSH_TRANSPORT === "memory";
  const keyId = process.env.APNS_KEY_ID?.trim() ?? "";
  const teamId = process.env.APNS_TEAM_ID?.trim() ?? "";
  const privateKey = (process.env.APNS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n").trim();
  const bundleId = process.env.APNS_BUNDLE_ID?.trim() || "com.manaresto.caisse";
  return { enabled: memory || (!!keyId && !!teamId && !!privateKey), keyId, teamId, privateKey, bundleId };
}
export const isApnsConfigured = () => apnsConfig().enabled;

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Jeton d'accès APNs (JWT ES256 : en-tête alg + kid, émetteur = Team ID, date d'émission). */
export function apnsJwt(cfg: { keyId: string; teamId: string; privateKey: string | KeyObject }, now = Date.now()) {
  const header = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId }));
  const claims = b64url(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(now / 1000) }));
  const key = typeof cfg.privateKey === "string" ? createPrivateKey(cfg.privateKey) : cfg.privateKey;
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${b64url(signature)}`;
}

// Apple demande de réutiliser le jeton (entre 20 et 60 minutes) et la connexion HTTP/2
let cachedJwt: { value: string; at: number; keyId: string } | null = null;
function currentJwt() {
  const cfg = apnsConfig();
  if (!cachedJwt || cachedJwt.keyId !== cfg.keyId || Date.now() - cachedJwt.at > 45 * 60_000) cachedJwt = { value: apnsJwt(cfg), at: Date.now(), keyId: cfg.keyId };
  return cachedJwt.value;
}

const sessions = new Map<string, http2.ClientHttp2Session>();
function sessionFor(origin: string) {
  let s = sessions.get(origin);
  if (!s || s.closed || s.destroyed) {
    s = http2.connect(origin);
    s.on("error", () => sessions.delete(origin));
    s.on("close", () => sessions.delete(origin));
    s.unref();
    sessions.set(origin, s);
  }
  return s;
}

/** Ferme les connexions gardées ouvertes vers Apple (arrêt du serveur, tests). */
export function closeApnsSessions() {
  for (const s of sessions.values()) s.close();
  sessions.clear();
}

function post(origin: string, path: string, headers: Record<string, string>, body: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = sessionFor(origin).request({ ":method": "POST", ":path": path, ...headers });
    let status = 0;
    let data = "";
    req.setEncoding("utf8");
    req.setTimeout(10_000, () => { req.close(); reject(new Error("délai dépassé")); });
    req.on("response", (h) => { status = Number(h[":status"] ?? 0); });
    req.on("data", (chunk: string) => { data += chunk; });
    req.on("end", () => resolve({ status, body: data }));
    req.on("error", reject);
    req.end(body);
  });
}

const apnsTransport: Transport = async (m) => {
  const cfg = apnsConfig();
  // APNS_ORIGIN : faux serveur APNs local, pour les tests seulement
  const origin = process.env.APNS_ORIGIN || (m.environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
  try {
    const r = await post(origin, `/3/device/${m.token}`, {
      authorization: `bearer ${currentJwt()}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 600),
      "apns-collapse-id": m.collapseId.slice(0, 64),
      "content-type": "application/json",
    }, JSON.stringify(m.payload));
    if (r.status === 200) return { ok: true };
    const reason = (() => { try { return (JSON.parse(r.body) as { reason?: string }).reason ?? ""; } catch { return ""; } })();
    // Appli désinstallée, notifications coupées, jeton d'un autre environnement : l'appareil est retiré
    const gone = r.status === 410 || ["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"].includes(reason);
    return { ok: false, gone, error: `APNs ${r.status} ${reason}`.trim() };
  } catch (e) {
    return { ok: false, gone: false, error: `APNs ${(e as Error).message ?? e}`.slice(0, 200) };
  }
};
const memoryTransport: Transport = async (m) => { sentApns.push(m); return { ok: true }; };
const defaultTransport: Transport = (m) => (process.env.PUSH_TRANSPORT === "memory" ? memoryTransport : apnsTransport)(m);
let transport: Transport = defaultTransport;
export function setApnsTransport(t: Transport | null) { transport = t ?? defaultTransport; }

export function apnsPayload(p: { title: string; body: string; url: string; tag: string; orderId?: string | null }): ApnsPayload {
  return { aps: { alert: { title: p.title, body: p.body }, sound: "default", "thread-id": p.tag }, url: p.url, orderId: p.orderId ?? null };
}

/** Envoi à un appareil ; met à jour son suivi (succès, échecs, retrait d'un appareil qui n'existe plus). */
export async function sendToApnsDevice(device: { id: string; token: string; environment: string; failures: number }, payload: ApnsPayload, collapseId: string) {
  const r = await transport({ token: device.token, environment: device.environment, payload, collapseId }).catch((e): SendResult => ({ ok: false, gone: false, error: String((e as Error).message ?? e).slice(0, 200) }));
  if (r.ok) {
    await prisma.apnsDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date(), failures: 0 } }).catch(() => {});
    return true;
  }
  if (r.gone || device.failures + 1 >= 10) await prisma.apnsDevice.delete({ where: { id: device.id } }).catch(() => {});
  else await prisma.apnsDevice.update({ where: { id: device.id }, data: { failures: { increment: 1 } } }).catch(() => {});
  console.warn("[push] envoi APNs refusé", r.error);
  return false;
}

/** Enregistre l'iPhone / iPad de la personne connectée (un jeton n'appartient qu'à une personne à la fois). */
export async function registerApnsDevice(actor: Actor, input: { token: string; environment: "production" | "sandbox"; deviceName?: string | null }) {
  if (!isApnsConfigured()) throw new ApiError(503, "PUSH_DISABLED", "Notifications de l'app iOS non configurées sur ce serveur");
  const token = input.token.toLowerCase();
  if (!/^[0-9a-f]{64,200}$/.test(token)) throw new ApiError(400, "BAD_TOKEN", "Jeton de notification invalide");
  const data = { establishmentId: actor.establishmentId, userId: actor.userId, environment: input.environment, deviceName: input.deviceName?.slice(0, 80) ?? null, failures: 0 };
  const row = await prisma.apnsDevice.upsert({ where: { token }, create: { token, ...data }, update: data });
  return { id: row.id };
}

/** Retire l'appareil (changement d'utilisateur, déconnexion, notifications désactivées). */
export async function unregisterApnsDevice(actor: Actor, token: string) {
  await prisma.apnsDevice.deleteMany({ where: { token: token.toLowerCase(), userId: actor.userId } });
  return { ok: true };
}
