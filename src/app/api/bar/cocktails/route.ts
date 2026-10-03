import { route, ok } from "@/server/http";
import { requireBar } from "@/server/bar-auth";
import { listCocktails } from "@/server/services/bar";

/** Boissons du bar et leurs fiches (verre, garniture, préparation, doses). */
export const GET = route(async () => {
  const ctx = await requireBar("use");
  return ok(await listCocktails(ctx.establishment.id));
});
