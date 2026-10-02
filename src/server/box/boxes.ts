import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { rateLimit, clientIp } from "@/server/rate-limit";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/services/orders";

/**
 * Boîtiers locaux (mini-PC de secours) : chaque boîtier reçoit une clé `mrbox_…` (affichée une seule fois,
 * stockée hachée) avec laquelle il télécharge la copie de son établissement.
 */
const hash = (key: string) => createHash("sha256").update(key).digest("hex");
const view = { id: true, name: true, lastSeenAt: true, lastIp: true, lanIp: true, version: true, revokedAt: true, createdAt: true } as const;

export async function listBoxes(establishmentId: string) {
  return prisma.localBox.findMany({ where: { establishmentId, revokedAt: null }, orderBy: { createdAt: "desc" }, select: view });
}

export async function createBox(actor: Actor, input: { name: string }) {
  const key = `mrbox_${randomBytes(24).toString("base64url")}`;
  const row = await prisma.localBox.create({ data: { establishmentId: actor.establishmentId, name: input.name, tokenHash: hash(key), createdById: actor.userId }, select: view });
  await audit({ ...actor, action: "box.create", entityType: "local_box", entityId: row.id, newValue: { name: row.name } });
  return { ...row, key }; // clé en clair une seule fois
}

export async function revokeBox(actor: Actor, id: string) {
  const existing = await prisma.localBox.findFirst({ where: { id, establishmentId: actor.establishmentId, revokedAt: null } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Boîtier introuvable");
  await prisma.localBox.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit({ ...actor, action: "box.revoke", entityType: "local_box", entityId: id, oldValue: { name: existing.name } });
}

/** Authentifie un boîtier (`Authorization: Bearer mrbox_…`) et note sa dernière visite. */
export async function requireBox(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const ip = clientIp(req);
  await rateLimit(`box-ip:${ip}`, 60);
  if (!key.startsWith("mrbox_")) throw new ApiError(401, "UNAUTHORIZED", "Clé du boîtier manquante");
  const row = await prisma.localBox.findUnique({ where: { tokenHash: hash(key) }, include: { establishment: { select: { isActive: true, organization: { select: { blockedAt: true } } } } } });
  if (!row || row.revokedAt || !row.establishment.isActive) throw new ApiError(401, "UNAUTHORIZED", "Clé du boîtier invalide ou révoquée");
  if (row.establishment.organization.blockedAt) throw new ApiError(403, "ACCOUNT_BLOCKED", "Compte suspendu");
  const lanIp = req.headers.get("x-box-lan-ip")?.slice(0, 64) || undefined;
  const version = req.headers.get("x-box-version")?.slice(0, 64) || undefined;
  prisma.localBox.update({ where: { id: row.id }, data: { lastSeenAt: new Date(), lastIp: ip, lanIp, version } }).catch(() => {});
  return { id: row.id, establishmentId: row.establishmentId };
}

/** Boîtier : l'application tourne sur le mini-PC du restaurant (et non sur le cloud). */
export const isBoxMode = () => process.env.BOX_MODE === "1";

/** Boîtier : seule la passerelle du boîtier (même machine) peut remplacer la base, avec le secret partagé. */
export function requireBoxSecret(req: NextRequest) {
  const secret = process.env.BOX_SECRET ?? "";
  const given = req.headers.get("x-box-secret") ?? "";
  if (!isBoxMode()) throw new ApiError(404, "NOT_FOUND", "Introuvable");
  const a = Buffer.from(secret), b = Buffer.from(given);
  if (secret.length < 24 || a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(401, "UNAUTHORIZED", "Secret du boîtier invalide");
}
