import { route, ok, parseBody } from "@/server/http";
import { requireBar } from "@/server/bar-auth";
import { actorFrom } from "@/server/auth/authorize";
import { barInventorySchema } from "@/server/schemas";
import { barInventory } from "@/server/services/bar";

/** Inventaire du bar (bouteilles pleines + entamée). */
export const POST = route(async (req) => {
  const ctx = await requireBar("manage");
  return ok(await barInventory(actorFrom(ctx), (await parseBody(req, barInventorySchema)).counts));
});
