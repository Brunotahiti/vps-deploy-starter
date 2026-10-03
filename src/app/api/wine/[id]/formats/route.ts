import { route, ok, parseBody } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { actorFrom } from "@/server/auth/authorize";
import { wineFormatsSchema } from "@/server/schemas";
import { setFormats } from "@/server/services/wine";

/** Formats de vente du vin (bouteille, verre, carafe) : produits de la carte reliés à la cave. */
export const PUT = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireWine("manage");
  return ok(await setFormats(actorFrom(ctx), params.id, await parseBody(req, wineFormatsSchema)));
});
