import { route, ok, parseBody } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { actorFrom } from "@/server/auth/authorize";
import { wineSchema } from "@/server/schemas";
import { can } from "@/server/auth/context";
import { archiveWine, getWine, upsertWine, withoutCosts } from "@/server/services/wine";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireWine("use");
  const wine = await getWine(ctx.establishment.id, params.id);
  // L'équipe en salle consulte la fiche sans les prix d'achat ni l'historique de la cave
  return ok(can(ctx, "wine.manage") ? wine : { ...withoutCosts(wine), movements: [] });
});
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireWine("manage");
  return ok(await upsertWine(actorFrom(ctx), params.id, await parseBody(req, wineSchema)));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireWine("manage");
  await archiveWine(actorFrom(ctx), params.id);
  return ok({ ok: true });
});
