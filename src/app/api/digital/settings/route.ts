import { route, ok, parseBody } from "@/server/http";
import { requirePermission, requireOption } from "@/server/auth/context";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { actorFrom } from "@/server/auth/authorize";
import { digitalSettingsSchema } from "@/server/schemas";
import { digitalSettings, siteSettings } from "@/server/services/public";
import { loyaltySettings } from "@/server/services/customers";

/** Réglages des canaux clients (QR, commande en ligne, borne) et du programme de fidélité. */
export const GET = route(async () => {
  const ctx = await requirePermission("settings.manage");
  requireOption(ctx, "digital");
  const [digital, loyalty, site] = await Promise.all([digitalSettings(ctx.establishment.id), loyaltySettings(ctx.establishment.id), siteSettings(ctx.establishment.id)]);
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.organizationId }, select: { slug: true } });
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || "";
  return ok({ ...digital, loyalty, site, urls: { shop: `${base}/commander/${org.slug}/${ctx.establishment.slug}`, reserve: `${base}/reserver/${org.slug}/${ctx.establishment.slug}`, kiosk: `${base}/kiosk`, site: `${base}/site/${org.slug}/${ctx.establishment.slug}` } });
});
export const PATCH = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  requireOption(ctx, "digital");
  const body = await parseBody(req, digitalSettingsSchema);
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: ctx.establishment.id }, select: { settings: true } });
  const current = (est.settings ?? {}) as Record<string, unknown>;
  const digital = (current.digital ?? {}) as Record<string, unknown>;
  const next = {
    ...current,
    digital: { ...digital, ...(body.qrMode ? { qrMode: body.qrMode } : {}), ...(body.online ? { online: { ...((digital.online as object) ?? {}), ...body.online } } : {}), ...(body.kiosk ? { kiosk: { ...((digital.kiosk as object) ?? {}), ...body.kiosk } } : {}) },
    ...(body.loyalty ? { loyalty: { ...((current.loyalty as object) ?? {}), ...body.loyalty } } : {}),
    ...(body.site ? { site: { ...((current.site as object) ?? {}), ...body.site } } : {}),
  };
  await prisma.establishment.update({ where: { id: ctx.establishment.id }, data: { settings: next } });
  await audit({ ...actorFrom(ctx), action: "settings.digital", entityType: "establishment", entityId: ctx.establishment.id, newValue: body });
  const [digitalNow, loyalty, site] = await Promise.all([digitalSettings(ctx.establishment.id), loyaltySettings(ctx.establishment.id), siteSettings(ctx.establishment.id)]);
  return ok({ ...digitalNow, loyalty, site });
});
