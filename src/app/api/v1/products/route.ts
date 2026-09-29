import { route, ok } from "@/server/http";
import { requireApiKey } from "@/server/api-keys";
import { publicCatalog } from "@/server/services/public";

/** API publique v1 — catalogue disponible (catégories, produits, variantes, options, formules). */
export const GET = route(async (req) => {
  const ctx = await requireApiKey(req, "catalog:read");
  return ok(await publicCatalog(ctx.establishmentId));
});
