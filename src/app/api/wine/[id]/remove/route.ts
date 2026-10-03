import { route, ok, parseBody } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { actorFrom } from "@/server/auth/authorize";
import { wineRemoveSchema } from "@/server/schemas";
import { removeWine } from "@/server/services/wine";

/** Sortie de cave hors vente : casse, perte, dégustation (motif obligatoire). */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireWine("use");
  return ok(await removeWine(actorFrom(ctx), params.id, await parseBody(req, wineRemoveSchema)));
});
