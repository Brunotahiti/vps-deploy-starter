import { route, ok, parseBody } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { actorFrom } from "@/server/auth/authorize";
import { wineDiscardSchema } from "@/server/schemas";
import { discardOpenBottle } from "@/server/services/wine";

/** Jette la fin d'une bouteille ouverte (sortie de stock en perte). */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireWine("use");
  return ok(await discardOpenBottle(actorFrom(ctx), params.id, (await parseBody(req, wineDiscardSchema)).reason ?? null));
});
