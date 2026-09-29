import type { NextRequest } from "next/server";
import { ApiError } from "@/server/errors";

/**
 * Limitation de débit en mémoire (fenêtre glissante) pour les points d'entrée publics et l'API.
 * Une instance = un compteur ; avec plusieurs instances derrière Redis, chaque instance limite sa part.
 */
const buckets = new Map<string, number[]>();
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of buckets) if (!v.length || v[v.length - 1] < now - 10 * 60_000) buckets.delete(k);
}

/** Lève 429 si `key` dépasse `limit` appels par fenêtre de `windowMs`. */
export function rateLimit(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  sweep(now);
  const hits = (buckets.get(key) ?? []).filter((t) => t > now - windowMs);
  if (hits.length >= limit) {
    const retry = Math.ceil((hits[0] + windowMs - now) / 1000);
    throw new ApiError(429, "RATE_LIMITED", `Trop de requêtes, réessayez dans ${retry} s`, { retryAfter: retry });
  }
  hits.push(now);
  buckets.set(key, hits);
}

export function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/** Limite par adresse IP et par périmètre (ex. "public-order"). */
export function rateLimitIp(req: NextRequest, scope: string, limit: number, windowMs = 60_000) {
  rateLimit(`${scope}:${clientIp(req)}`, limit, windowMs);
}

/** Tests : remise à zéro. */
export function resetRateLimits() { buckets.clear(); }
