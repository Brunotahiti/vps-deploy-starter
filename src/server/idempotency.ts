import { prisma } from "@/server/db";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Idempotence des opérations sensibles (commandes, paiements) rejouées après
 * une reconnexion : la première réponse est stockée et renvoyée telle quelle
 * pour toute requête ultérieure portant la même clé `Idempotency-Key`.
 */
export async function withIdempotency(
  req: NextRequest,
  establishmentId: string,
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const key = req.headers.get("idempotency-key");
  if (!key) return fn();
  const scoped = `${establishmentId}:${key}`;
  const existing = await prisma.idempotencyKey.findUnique({ where: { key: scoped } });
  if (existing) {
    return NextResponse.json(existing.response, { status: existing.statusCode, headers: { "Idempotent-Replayed": "true" } });
  }
  const res = await fn();
  const body = await res.clone().json().catch(() => null);
  if (body !== null && res.status < 500) {
    await prisma.idempotencyKey
      .create({ data: { key: scoped, establishmentId, statusCode: res.status, response: body } })
      .catch(() => {});
  }
  return res;
}
