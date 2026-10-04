import { route, ok, parseBody } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { actorFrom } from "@/server/auth/authorize";
import { wineOpenAdjustSchema } from "@/server/schemas";
import { adjustOpenBottle } from "@/server/services/wine";

/** Corrige le niveau d'une bouteille ouverte. */
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireWine("use");
  return ok(await adjustOpenBottle(actorFrom(ctx), params.id, (await parseBody(req, wineOpenAdjustSchema)).remainingMl));
});
