import acme from "acme-client";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";

/**
 * Adresse HTTPS du boîtier sur le réseau du restaurant : `<8 premiers caractères de l'id>.<BOX_DNS_ZONE>`
 * (ex. 1a2b3c4d.box.manaresto.com), enregistrement DNS A vers l'adresse locale du mini-PC, certificat Let's Encrypt
 * obtenu par le cloud (défi DNS-01 chez Cloudflare : rien n'a besoin d'être ouvert vers le restaurant).
 * Sans HTTPS, une tablette ne peut ni installer l'application ni se connecter par PIN hors ligne.
 *
 * Configuration (cloud) : BOX_DNS_ZONE, CLOUDFLARE_API_TOKEN (droit « DNS : modifier » sur la zone), CLOUDFLARE_ZONE_ID,
 * ACME_EMAIL (facultatif), ACME_DIRECTORY (facultatif : annuaire de test).
 */
const zone = () => (process.env.BOX_DNS_ZONE ?? "").replace(/^\.+|\.+$/g, "").toLowerCase();
export const dnsConfigured = () => !!(zone() && process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ZONE_ID);
export const boxHostname = (boxId: string) => (zone() ? `${boxId.replace(/-/g, "").slice(0, 8)}.${zone()}` : null);

/** Adresse IPv4 d'un réseau local (10/8, 172.16/12, 192.168/16) : jamais une adresse publique. */
export function isPrivateIpv4(ip: string) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

type CfRecord = { id: string; type: string; name: string; content: string };

async function cloudflare<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => null)) as { success?: boolean; result?: T; errors?: { message: string }[] } | null;
  if (!res.ok || !json?.success) throw new ApiError(502, "DNS_ERROR", `DNS : ${json?.errors?.map((e) => e.message).join(", ") || res.status}`);
  return json.result as T;
}

/** Crée ou met à jour un enregistrement (jamais « proxied » : l'adresse est locale). */
export async function upsertDnsRecord(type: "A" | "TXT", name: string, content: string) {
  const existing = await cloudflare<CfRecord[]>("GET", `/dns_records?type=${type}&name=${encodeURIComponent(name)}`);
  const same = existing.find((r) => r.content === content || r.content === `"${content}"`);
  if (same) return same;
  const record = { type, name, content, ttl: 60, proxied: false };
  // Défi Let's Encrypt : plusieurs valeurs TXT peuvent coexister ; adresse : une seule
  if (type === "A" && existing[0]) return cloudflare<CfRecord>("PUT", `/dns_records/${existing[0].id}`, record);
  return cloudflare<CfRecord>("POST", "/dns_records", record);
}

export async function deleteDnsRecords(type: "A" | "TXT", name: string, content?: string) {
  const existing = await cloudflare<CfRecord[]>("GET", `/dns_records?type=${type}&name=${encodeURIComponent(name)}`);
  for (const r of existing) if (!content || r.content === content || r.content === `"${content}"`) await cloudflare("DELETE", `/dns_records/${r.id}`);
}

function requireDns(boxId: string) {
  const host = boxHostname(boxId);
  if (!dnsConfigured() || !host) throw new ApiError(503, "DNS_NOT_CONFIGURED", "Adresse HTTPS des boîtiers non configurée sur ManaResto (BOX_DNS_ZONE, Cloudflare)");
  return host;
}

/** Fait pointer l'adresse du boîtier vers le mini-PC sur le réseau du restaurant. */
export async function setBoxAddress(box: { id: string }, lanIp: string) {
  if (!isPrivateIpv4(lanIp)) throw new ApiError(400, "BAD_LAN_IP", "Adresse locale invalide (réseau du restaurant attendu, ex. 192.168.1.20)");
  const host = requireDns(box.id);
  await upsertDnsRecord("A", host, lanIp);
  await prisma.localBox.update({ where: { id: box.id }, data: { lanIp } });
  return host;
}

/** Compte Let's Encrypt de la plateforme : créé une fois, gardé en base. */
async function accountKey() {
  const row = await prisma.platformSecret.findUnique({ where: { key: "acme_account_key" } });
  if (row) return row.value;
  const key = (await acme.crypto.createPrivateKey()).toString();
  await prisma.platformSecret.upsert({ where: { key: "acme_account_key" }, create: { key: "acme_account_key", value: key }, update: {} });
  return (await prisma.platformSecret.findUniqueOrThrow({ where: { key: "acme_account_key" } })).value;
}

/**
 * Certificat de l'adresse du boîtier. La clé privée est créée ici, envoyée une seule fois au boîtier (connexion
 * chiffrée, clé du boîtier) et jamais gardée par le cloud.
 */
export async function issueBoxCertificate(box: { id: string }) {
  const host = requireDns(box.id);
  const client = new acme.Client({ directoryUrl: process.env.ACME_DIRECTORY || acme.directory.letsencrypt.production, accountKey: await accountKey() });
  const [key, csr] = await acme.crypto.createCsr({ commonName: host });
  const challenge = `_acme-challenge.${host}`;
  const cert = await client.auto({
    csr,
    email: process.env.ACME_EMAIL || undefined,
    termsOfServiceAgreed: true,
    challengePriority: ["dns-01"],
    challengeCreateFn: async (_authz, ch, value) => { if (ch.type === "dns-01") await upsertDnsRecord("TXT", challenge, value); },
    challengeRemoveFn: async (_authz, ch, value) => { if (ch.type === "dns-01") await deleteDnsRecords("TXT", challenge, value).catch(() => {}); },
  });
  const info = acme.crypto.readCertificateInfo(cert);
  return { hostname: host, key: key.toString(), cert, notAfter: info.notAfter.toISOString() };
}
