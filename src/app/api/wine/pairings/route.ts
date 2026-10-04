import { route, ok } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { pairings } from "@/server/services/wine";

/** Accords mets-vins : pour chaque plat, les vins conseillés et leurs formats en vente (caisse). */
export const GET = route(async () => {
  const ctx = await requireWine("use");
  return ok(await pairings(ctx.establishment.id));
});
