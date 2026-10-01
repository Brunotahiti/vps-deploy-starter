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

/** Limite par adresse IP et par périmètre (ex. "public-order"). */
export async function rateLimitIp(req: NextRequest, scope: string, limit: number, windowMs = 60_000) {
  await rateLimit(`${scope}:${clientIp(req)}`, limit, windowMs);
}

/** Tests : remise à zéro. */
export async function resetRateLimits() { await resetAttempts(); }
