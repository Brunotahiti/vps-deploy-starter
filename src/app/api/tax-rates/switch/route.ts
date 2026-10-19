import { z } from "zod";
import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { bps } from "@/server/schemas";
import { switchCatalogTaxRate } from "@/server/services/catalog";

const schema = z.object({ name: z.string().trim().min(1).max(60), rateBps: bps.max(10000), keepCategoryIds: z.array(z.string().uuid()).max(500), makeDefault: z.boolean().optional() });

/** Nouveau taux pour toute la carte, sauf les catégories gardées (ex. TVA des îles à 1 %, hors sucré et alcool) */
export const POST = route(async (req) => {
  const ctx = await requirePermission("catalog.manage");
  return ok(await switchCatalogTaxRate(actorFrom(ctx), await parseBody(req, schema)));
});
