import { route, ok } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { listOpenBottles } from "@/server/services/wine";

/** Bouteilles ouvertes (vin au verre) : niveau, âge, alerte de conservation. */
export const GET = route(async () => {
  const ctx = await requireWine("use");
  return ok(await listOpenBottles(ctx.establishment.id));
});
