import { route, ok, parseBody } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { actorFrom } from "@/server/auth/authorize";
import { wineInventorySchema } from "@/server/schemas";
import { wineInventory } from "@/server/services/wine";

/** Inventaire de la cave (bouteilles pleines comptées, éventuellement par emplacement). */
export const POST = route(async (req) => {
  const ctx = await requireWine("manage");
  const body = await parseBody(req, wineInventorySchema);
  return ok(await wineInventory(actorFrom(ctx), body.counts, body.location ?? null));
});
