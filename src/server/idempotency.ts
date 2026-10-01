import { prisma } from "@/server/db";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const IN_PROGRESS = 102; // réservation en cours (pas encore de réponse)

/**
 * Idempotence des opérations sensibles (commandes, paiements) rejouées après une reconnexion :
 * la clé est RÉSERVÉE avant l'exécution (insertion unique), si bien que deux requêtes simultanées
 * portant la même clé ne s'exécutent jamais toutes les deux. La première réponse (< 500) est stockée
 * et renvoyée telle quelle ; une requête arrivant pendant l'exécution reçoit 409 « en cours » (à réessayer).
 */
export async function withIdempotency(
  req: NextRequest,
  establishmentId: string,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const key = req.headers.get("idempotency-key");
  if (!key) return fn();
  const scoped = `${establishmentId}:${req.method}:${req.nextUrl.pathname}:${key}`.slice(0, 250);
  try {
    await prisma.idempotencyKey.create({ data: { key: scoped, establishmentId, statusCode: IN_PROGRESS, response: {} } });
  } catch {
    const existing = await prisma.idempotencyKey.findUnique({ where: { key: scoped } });
    if (existing && existing.statusCode !== IN_PROGRESS) {
      return NextResponse.json(existing.response, { status: existing.statusCode, headers: { "Idempotent-Replayed": "true" } });
    }
    if (existing && Date.now() - existing.createdAt.getTime() > 120_000) {
      // Réservation abandonnée (serveur redémarré pendant l'opération) : on la libère et on exécute
      await prisma.idempotencyKey.deleteMany({ where: { key: scoped, statusCode: IN_PROGRESS } });
      return withIdempotency(req, establishmentId, fn);
    }
    return NextResponse.json({ error: { code: "IN_PROGRESS", message: "Opération déjà en cours de traitement" } }, { status: 409, headers: { "Idempotency-In-Progress": "true", "Retry-After": "2" } });
  }
  let res: NextResponse;
  try {
    res = await fn();
  } catch (e) {
    await prisma.idempotencyKey.delete({ where: { key: scoped } }).catch(() => {});
    throw e;
  }
  const body = await res.clone().json().catch(() => null);
  if (body !== null && res.status < 500) {
    await prisma.idempotencyKey.update({ where: { key: scoped }, data: { statusCode: res.status, response: body } }).catch(() => {});
  } else {
    await prisma.idempotencyKey.delete({ where: { key: scoped } }).catch(() => {}); // erreur serveur : un nouvel essai pourra s'exécuter
  }
  return res;
}
