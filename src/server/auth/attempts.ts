import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";

/*
 * Limitation des tentatives et des appels à fenêtre glissante, stockée en base : les compteurs survivent
 * aux redémarrages et aux déploiements (un attaquant ne repart pas de zéro), et valent pour toutes les instances.
 * La tentative est RÉSERVÉE avant la vérification, sous verrou par clé (les requêtes parallèles ne passent pas toutes),
 * et un succès ne libère que SA réservation : le bon PIN d'un employé ne remet pas à zéro
 * le compteur d'un autre qui cherche à deviner un PIN.
 */
const KEEP_MS = 24 * 3600_000;

async function hit(key: string, limit: number, windowMs: number, message: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const since = new Date(Date.now() - windowMs);
    const hits = await tx.rateHit.findMany({ where: { key, at: { gt: since } }, orderBy: { at: "asc" }, take: limit, select: { at: true } });
    if (hits.length >= limit) {
      const retryAfter = Math.max(1, Math.ceil((hits[0].at.getTime() + windowMs - Date.now()) / 1000));
      throw new ApiError(429, "RATE_LIMITED", message.replace("{s}", String(retryAfter)), { retryAfter });
    }
    const row = await tx.rateHit.create({ data: { key }, select: { id: true } });
    return row.id;
  });
}

/** Ménage occasionnel des tentatives anciennes (jamais bloquant). */
function sweep() {
  if (Math.random() < 0.02) prisma.rateHit.deleteMany({ where: { at: { lt: new Date(Date.now() - KEEP_MS) } } }).catch(() => {});
}

/** Réserve une tentative ; lève 429 si la limite est atteinte. Retourne la fonction à appeler en cas de succès. */
export async function reserveAttempt(key: string, limit: number, windowMs: number, message = "Trop de tentatives, réessayez dans quelques minutes"): Promise<() => Promise<void>> {
  sweep();
  const id = await hit(key, limit, windowMs, message);
  return async () => { await prisma.rateHit.deleteMany({ where: { id } }).catch(() => {}); };
}

/** Compte un appel ; lève 429 au-delà de `limit` appels par fenêtre. */
export async function countHit(key: string, limit: number, windowMs: number, message: string) {
  sweep();
  await hit(key, limit, windowMs, message);
}

/** Pour les tests : vide les compteurs. */
export async function resetAttempts() {
  await prisma.rateHit.deleteMany({});
}
