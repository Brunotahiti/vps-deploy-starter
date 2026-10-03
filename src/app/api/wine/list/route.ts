import { route, ok } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { wineList } from "@/server/services/wine";

/** Carte des vins (rubriques par couleur et région), telle qu'elle s'affiche et s'imprime. */
export const GET = route(async () => {
  const ctx = await requireWine("use");
  return ok(await wineList(ctx.establishment.id));
});
