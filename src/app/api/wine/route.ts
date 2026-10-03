import { route, ok, created, parseBody } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { actorFrom } from "@/server/auth/authorize";
import { wineSchema } from "@/server/schemas";
import { can } from "@/server/auth/context";
import { listWines, upsertWine, withoutCosts } from "@/server/services/wine";

/** Cave à vin : fiches, stock en bouteilles, bouteilles ouvertes, formats de vente. */
export const GET = route(async (req) => {
  const ctx = await requireWine("use");
  const wines = await listWines(ctx.establishment.id, { includeInactive: req.nextUrl.searchParams.get("all") === "1" });
  return ok(can(ctx, "wine.manage") ? wines : wines.map(withoutCosts));
});
export const POST = route(async (req) => {
  const ctx = await requireWine("manage");
  return created(await upsertWine(actorFrom(ctx), null, await parseBody(req, wineSchema)));
});
