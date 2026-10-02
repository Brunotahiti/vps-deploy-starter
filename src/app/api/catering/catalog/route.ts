import { route, ok } from "@/server/http";
import { requireCatering } from "@/server/catering-auth";
import { quoteCatalog } from "@/server/services/catering";

/** Plats de la carte et taux de TVA, pour composer un devis. */
export const GET = route(async () => {
  const ctx = await requireCatering("manage");
  return ok(await quoteCatalog(ctx.establishment.id));
});
