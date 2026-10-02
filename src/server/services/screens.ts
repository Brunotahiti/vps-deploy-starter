import { randomBytes } from "node:crypto";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import type { Actor } from "./orders";

/**
 * Écrans en salle (option « screens ») : la carte affichée sur une télévision ou une tablette, à une adresse secrète
 * (pas de connexion d'un employé sur l'écran). Les données se relisent toutes les 30 secondes : prix et plats
 * épuisés sont toujours à jour.
 */

const newToken = () => randomBytes(18).toString("base64url");

type ScreenInput = { name: string; categoryIds?: string[]; showPrices?: boolean; hideSoldOut?: boolean; showImages?: boolean; rotateSeconds?: number; theme?: "lagoon" | "night" | "light"; headline?: string | null; headlineText?: string | null; headlinePrice?: number | null; isActive?: boolean };

export async function listScreens(establishmentId: string) {
  return prisma.screen.findMany({ where: { establishmentId }, orderBy: { createdAt: "asc" } });
}

export async function upsertScreen(actor: Actor, input: ScreenInput & { id?: string }) {
  if (input.categoryIds?.length) {
    const n = await prisma.category.count({ where: { id: { in: input.categoryIds }, establishmentId: actor.establishmentId } });
    if (n !== input.categoryIds.length) throw new ApiError(400, "BAD_CATEGORY", "Catégorie inconnue");
  }
  const data = {
    name: input.name, ...(input.categoryIds !== undefined ? { categoryIds: input.categoryIds } : {}), ...(input.showPrices !== undefined ? { showPrices: input.showPrices } : {}),
    ...(input.hideSoldOut !== undefined ? { hideSoldOut: input.hideSoldOut } : {}), ...(input.showImages !== undefined ? { showImages: input.showImages } : {}),
    ...(input.rotateSeconds !== undefined ? { rotateSeconds: input.rotateSeconds } : {}), ...(input.theme !== undefined ? { theme: input.theme } : {}),
    ...(input.headline !== undefined ? { headline: input.headline || null } : {}), ...(input.headlineText !== undefined ? { headlineText: input.headlineText || null } : {}),
    ...(input.headlinePrice !== undefined ? { headlinePrice: input.headlinePrice } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
  if (input.id) {
    const old = await prisma.screen.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!old) throw new ApiError(404, "NOT_FOUND", "Écran introuvable");
    return prisma.screen.update({ where: { id: old.id }, data });
  }
  const s = await prisma.screen.create({ data: { ...data, establishmentId: actor.establishmentId, token: newToken() } });
  await audit({ ...actor, action: "screen.create", entityType: "screen", entityId: s.id, newValue: { name: s.name } });
  return s;
}

export async function deleteScreen(actor: Actor, id: string) {
  const s = await prisma.screen.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!s) throw new ApiError(404, "NOT_FOUND", "Écran introuvable");
  await prisma.screen.delete({ where: { id } });
  await audit({ ...actor, action: "screen.delete", entityType: "screen", entityId: id, oldValue: { name: s.name } });
}

/** Nouvelle adresse : l'ancienne cesse de fonctionner (télévision volée, lien partagé par erreur). */
export async function regenerateScreenToken(actor: Actor, id: string) {
  const s = await prisma.screen.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!s) throw new ApiError(404, "NOT_FOUND", "Écran introuvable");
  const upd = await prisma.screen.update({ where: { id }, data: { token: newToken(), lastSeenAt: null } });
  await audit({ ...actor, action: "screen.token", entityType: "screen", entityId: id });
  return upd;
}

/** Ce que l'écran affiche, d'après son adresse secrète. */
export async function screenDisplay(token: string, now = new Date()) {
  const s = await prisma.screen.findUnique({ where: { token }, include: { establishment: { select: { id: true, name: true, currency: true, timezone: true, settings: true, isActive: true, organization: { select: { options: true, blockedAt: true } } } } } });
  const e = s?.establishment;
  if (!s || !s.isActive || !e || !e.isActive || e.organization.blockedAt) throw new ApiError(404, "NOT_FOUND", "Écran introuvable ou désactivé");
  if (!e.organization.options.includes("screens")) throw new ApiError(403, "OPTION_REQUIRED", "Option « Écrans en salle » non active");
  // Repère « vu à l'instant » (au plus une écriture par minute)
  if (!s.lastSeenAt || now.getTime() - s.lastSeenAt.getTime() > 60_000) await prisma.screen.update({ where: { id: s.id }, data: { lastSeenAt: now } });
  const categories = await prisma.category.findMany({
    where: { establishmentId: e.id, isActive: true, ...(s.categoryIds.length ? { id: { in: s.categoryIds } } : {}) },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { products: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, description: true, priceTtc: true, imageUrl: true, isAvailable: true, autoUnavailable: true } } },
  });
  const site = ((e.settings ?? {}) as { site?: { logoUrl?: string } }).site;
  const ordered = s.categoryIds.length ? s.categoryIds.map((id) => categories.find((c) => c.id === id)).filter((c): c is (typeof categories)[number] => !!c) : categories;
  return {
    name: e.name, currency: e.currency, timezone: e.timezone, logoUrl: site?.logoUrl || null, theme: s.theme, rotateSeconds: s.rotateSeconds, showPrices: s.showPrices, showImages: s.showImages,
    headline: s.headline ? { title: s.headline, text: s.headlineText, price: s.headlinePrice } : null,
    categories: ordered.map((c) => ({
      id: c.id, name: c.name, color: c.color,
      products: c.products.map((p) => ({ id: p.id, name: p.name, description: p.description, price: p.priceTtc, imageUrl: s.showImages ? p.imageUrl : null, soldOut: !p.isAvailable || p.autoUnavailable }))
        .filter((p) => !(s.hideSoldOut && p.soldOut)),
    })).filter((c) => c.products.length > 0),
    at: now.toISOString(),
  };
}
