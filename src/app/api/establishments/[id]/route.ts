import { route, parseBody, ok } from "@/server/http";
import { requireAuth } from "@/server/auth/context";
import { establishmentUpdateSchema } from "@/server/schemas";
import { updateEstablishment } from "@/server/services/establishments";
import { ApiError } from "@/server/errors";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireAuth();
  if (!ctx.establishments.some((e) => e.id === params.id)) throw new ApiError(403, "FORBIDDEN", "Établissement non autorisé");
  const est = await prisma.establishment.findFirst({ where: { id: params.id, organizationId: ctx.organizationId }, include: { paymentMethods: { orderBy: { sortOrder: "asc" } }, terminals: { where: { isActive: true } } } });
  if (!est) throw new ApiError(404, "NOT_FOUND", "Établissement introuvable");
  return ok(est);
});

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireAuth();
  const member = ctx.establishments.find((e) => e.id === params.id);
  if (!member) throw new ApiError(403, "FORBIDDEN", "Établissement non autorisé");
  // La permission settings.manage s'évalue sur l'établissement ciblé
  const permsOk = ctx.user.isOwner || (ctx.establishment?.id === params.id && hasPermission(ctx.permissions, "settings.manage"));
  if (!permsOk) throw new ApiError(403, "FORBIDDEN", "Permission requise : settings.manage");
  const body = await parseBody(req, establishmentUpdateSchema);
  const est = await updateEstablishment(ctx.organizationId, params.id, ctx.user.id, {
    ...body, tipPresetsBps: body.tipPresetsBps as Prisma.InputJsonValue | undefined, openingHours: body.openingHours as Prisma.InputJsonValue | undefined, settings: body.settings as Prisma.InputJsonValue | undefined,
  });
  return ok(est);
});
