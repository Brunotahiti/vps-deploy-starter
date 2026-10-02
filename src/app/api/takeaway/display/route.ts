import { route, ok } from "@/server/http";
import { can, requireEstablishment } from "@/server/auth/context";
import { ApiError } from "@/server/errors";
import { callDisplay } from "@/server/services/takeaway";

export const dynamic = "force-dynamic";

/** Écran d'appel des numéros (caisse ou cuisine) : numéros en préparation et prêts, sans données personnelles. */
export const GET = route(async () => {
  const ctx = await requireEstablishment();
  if (!can(ctx, "pos.use") && !can(ctx, "kds.use")) throw new ApiError(403, "FORBIDDEN", "Permission requise : pos.use ou kds.use");
  return ok(await callDisplay(ctx.establishment.id));
});
