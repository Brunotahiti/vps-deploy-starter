import { prisma, type Tx } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { shareSlugError, shareUrl, suggestShareSlug, SHARE_SLUG_MAX } from "@/lib/share";
import { isDemoOrganization } from "./demo";
import type { Actor } from "./orders";

/** Adresse de partage libre à partir du nom (« chez-hina », sinon « chez-hina-2 », « chez-hina-3 »…). */
export async function uniqueShareSlug(db: Tx | typeof prisma, name: string, exceptId?: string) {
  const base = suggestShareSlug(name);
  for (let i = 1; ; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, SHARE_SLUG_MAX - String(i).length - 1)}-${i}`;
    const taken = await db.establishment.findUnique({ where: { shareSlug: candidate }, select: { id: true } });
    if (!taken || taken.id === exceptId) return candidate;
  }
}

/** Adresse de partage d'un établissement (attribuée au besoin, pour un établissement créé avant cette fonction). */
export async function ensureShareSlug(establishmentId: string) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { name: true, shareSlug: true } });
  if (est.shareSlug) return est.shareSlug;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const slug = await uniqueShareSlug(prisma, est.name, establishmentId);
      await prisma.establishment.update({ where: { id: establishmentId }, data: { shareSlug: slug } });
      return slug;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e; // pris entre-temps : on recommence
    }
  }
  throw new ApiError(409, "CONFLICT", "Adresse de partage indisponible : réessayez");
}

/** Adresse choisie par le restaurant (format, mots réservés, disponibilité). */
export async function setShareSlug(actor: Actor, raw: string) {
  const slug = raw.trim().toLowerCase();
  const err = shareSlugError(slug);
  if (err) throw new ApiError(400, "BAD_SHARE_SLUG", err);
  if (await isDemoOrganization(actor.organizationId)) throw new ApiError(403, "DEMO_LOCKED", "Restaurant exemple : l'adresse de partage ne se change pas");
  const old = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { shareSlug: true } });
  if (old.shareSlug === slug) return { shareSlug: slug, url: shareUrl(slug) };
  const taken = await prisma.establishment.findUnique({ where: { shareSlug: slug }, select: { id: true } });
  if (taken && taken.id !== actor.establishmentId) throw new ApiError(409, "SHARE_SLUG_TAKEN", "Cette adresse est déjà prise par un autre restaurant");
  try {
    await prisma.establishment.update({ where: { id: actor.establishmentId }, data: { shareSlug: slug } });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") throw new ApiError(409, "SHARE_SLUG_TAKEN", "Cette adresse est déjà prise par un autre restaurant");
    throw e;
  }
  await audit({ ...actor, action: "establishment.share_slug", entityType: "establishment", entityId: actor.establishmentId, oldValue: { shareSlug: old.shareSlug }, newValue: { shareSlug: slug } });
  return { shareSlug: slug, url: shareUrl(slug) };
}

/** Disponibilité (vérification pendant la saisie). */
export async function shareSlugAvailability(establishmentId: string, raw: string) {
  const slug = raw.trim().toLowerCase();
  const err = shareSlugError(slug);
  if (err) return { slug, available: false, reason: err };
  const taken = await prisma.establishment.findUnique({ where: { shareSlug: slug }, select: { id: true } });
  return taken && taken.id !== establishmentId ? { slug, available: false, reason: "Déjà prise par un autre restaurant" } : { slug, available: true, reason: null };
}

/** Adresse de partage → restaurant (identifiants publics de son site). */
export async function resolveShareSlug(slug: string) {
  const s = slug.toLowerCase();
  if (!/^[a-z0-9-]{1,45}$/.test(s)) return null;
  return prisma.establishment.findUnique({ where: { shareSlug: s }, select: { slug: true, shareSlug: true, organization: { select: { slug: true } } } });
}
