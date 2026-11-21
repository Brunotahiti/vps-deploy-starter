import type { NextRequest } from "next/server";
import { countHit, resetAttempts } from "@/server/auth/attempts";
import { resolveClientIp } from "@/server/net/client-ip";

/**
 * Limitation de débit des points d'entrée publics et de l'API (fenêtre glissante, stockée en base :
 * conservée aux redémarrages et partagée entre instances).
 */

/** Lève 429 si `key` dépasse `limit` appels par fenêtre de `windowMs`. */
export async function rateLimit(key: string, limit: number, windowMs = 60_000) {
  await countHit(`rl:${key}`, limit, windowMs, "Trop de requêtes, réessayez dans {s} s");
}

export function clientIp(req: NextRequest) {
  return resolveClientIp((n) => req.headers.get(n));
}

/**
 * Clé de limitation d'une adresse : en IPv6, le préfixe /64 (une box ou un serveur en reçoit des milliards d'adresses,
 * changer d'adresse ne doit pas remettre le compteur à zéro). En IPv4, l'adresse elle-même.
 */
export function ipRateKey(ip: string | null | undefined): string {
  if (!ip) return "?";
  const v6 = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (!v6.includes(":") || /^::ffff:\d+\.\d+\.\d+\.\d+$/.test(v6)) return v6.replace(/^::ffff:/, "");
  const [head, tail = ""] = v6.split("::");
  const h = head ? head.split(":") : [], t = tail ? tail.split(":") : [];
  const groups = v6.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return groups.slice(0, 4).map((g) => (parseInt(g || "0", 16) || 0).toString(16)).join(":") + "::/64";
}

/** Limite par adresse IP (préfixe /64 en IPv6) et par périmètre (ex. "public-order"). */
export async function rateLimitIp(req: NextRequest, scope: string, limit: number, windowMs = 60_000) {
  await rateLimit(`${scope}:${ipRateKey(clientIp(req))}`, limit, windowMs);
}

/** Tests : remise à zéro. */
export async function resetRateLimits() { await resetAttempts(); }
