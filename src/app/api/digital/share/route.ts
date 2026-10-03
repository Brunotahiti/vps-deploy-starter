import { z } from "zod";
import { route, ok, parseBody } from "@/server/http";
import { requirePermission, requireOption } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { setShareSlug, shareSlugAvailability } from "@/server/services/share";

/** Adresse de partage : disponibilité pendant la saisie (?slug=…). */
export const GET = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  requireOption(ctx, "digital");
  return ok(await shareSlugAvailability(ctx.establishment.id, (req.nextUrl.searchParams.get("slug") ?? "").slice(0, 60)));
});
/** Adresse de partage choisie par le restaurant. */
export const PATCH = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  requireOption(ctx, "digital");
  const { slug } = await parseBody(req, z.object({ slug: z.string().trim().min(1).max(60) }));
  return ok(await setShareSlug(actorFrom(ctx), slug));
});
