import { z } from "zod";
import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { setProductsTaxRate } from "@/server/services/catalog";

const schema = z.object({ taxRateId: z.string().uuid().nullable(), productIds: z.array(z.string().uuid()).max(2000).optional(), categoryId: z.string().uuid().nullable().optional(), all: z.boolean().optional() });

/** TVA de plusieurs produits d'un coup : sélection, catégorie ou toute la carte */
export const POST = route(async (req) => {
  const ctx = await requirePermission("catalog.manage");
  return ok(await setProductsTaxRate(actorFrom(ctx), await parseBody(req, schema)));
});
