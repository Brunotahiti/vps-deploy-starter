import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { rateLimit, clientIp } from "@/server/rate-limit";
import { audit } from "@/server/audit";
import type { Actor } from "@/server/services/orders";
import { createSession, TERMINAL_COOKIE } from "@/server/auth/session";
import { sha256 } from "@/server/auth/password";
import { boxHostname, deleteDnsRecords, dnsConfigured } from "@/server/box/certificate";

/**
 * Boîtiers locaux (mini-PC de secours) : chaque boîtier reçoit une clé `mrbox_…` (affichée une seule fois,
 * stockée hachée) avec laquelle il télécharge la copie de son établissement.
 */
const hash = (key: string) => createHash("sha256").update(key).digest("hex");
const view = { id: true, name: true, lastSeenAt: true, lastIp: true, lanIp: true, version: true, revokedAt: true, createdAt: true } as const;

/** Un boîtier garde une copie de l'équipe et du restaurant : seul le propriétaire en ajoute ou en retire. */
export function assertOwner(ctx: { user: { isOwner: boolean } }) {
  if (!ctx.user.isOwner) throw new ApiError(403, "OWNER_ONLY", "Seul le propriétaire peut ajouter ou retirer un boîtier de secours");
}

export async function listBoxes(establishmentId: string) {
  const rows = await prisma.localBox.findMany({ where: { establishmentId, revokedAt: null }, orderBy: { createdAt: "desc" }, select: view });
  // Adresse HTTPS à ouvrir sur les tablettes (si les adresses des boîtiers sont configurées sur ManaResto)
  return rows.map((b) => ({ ...b, hostname: dnsConfigured() ? boxHostname(b.id) : null }));
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
  // Sessions ouvertes par le boîtier et adresse HTTPS : retirées avec lui
  await prisma.session.deleteMany({ where: { boxId: id } });
  const host = boxHostname(id);
  if (dnsConfigured() && host) await deleteDnsRecords("A", host).catch(() => {});
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

/**
 * Connexion faite sur le boîtier pendant une coupure (PIN, mot de passe) : au retour d'internet, le boîtier demande
 * une session du cloud pour la même personne, sans jamais garder le PIN ni le mot de passe. Seulement pour un compte
 * actif rattaché à l'établissement du boîtier.
 */
export async function openBoxSession(req: NextRequest, box: { id: string; establishmentId: string }, userId: string) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: box.establishmentId }, select: { organizationId: true } });
  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: est.organizationId, isActive: true, OR: [{ isOwner: true }, { memberships: { some: { establishmentId: box.establishmentId } } }] }, select: { id: true } });
  if (!user) throw new ApiError(404, "NOT_FOUND", "Compte introuvable pour ce boîtier");
  // Seulement depuis une tablette enregistrée de l'établissement (comme la connexion par PIN)
  const deviceKey = req.cookies.get(TERMINAL_COOKIE)?.value;
  const terminal = deviceKey ? await prisma.terminal.findFirst({ where: { deviceKeyHash: sha256(deviceKey), establishmentId: box.establishmentId, isActive: true }, select: { id: true } }) : null;
  if (!terminal) throw new ApiError(403, "NO_TERMINAL", "Connexion reprise seulement depuis une tablette enregistrée de l'établissement");
  // Session « caisse » de 12 h dans l'établissement du boîtier, même pour le propriétaire ; supprimée si le boîtier est retiré
  const { token, session } = await createSession({ userId, establishmentId: box.establishmentId, terminalId: terminal.id, ip: clientIp(req), userAgent: req.headers.get("user-agent"), ttlMs: 12 * 3600_000, scope: "pos", boxId: box.id });
  await audit({ organizationId: est.organizationId, establishmentId: box.establishmentId, userId, action: "box.session", entityType: "local_box", entityId: box.id, newValue: { sessionId: session.id } });
  return { token, maxAge: Math.max(0, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)) };
}
