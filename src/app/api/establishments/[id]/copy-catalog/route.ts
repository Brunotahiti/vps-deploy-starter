import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { copyCatalogSchema } from "@/server/schemas";
import { copyCatalog } from "@/server/services/organization";

/** Copie le catalogue d'un établissement source vers l'établissement :id. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("establishments.manage");
  const body = await parseBody(req, copyCatalogSchema);
  return ok(await copyCatalog(actorFrom(ctx), body.fromId, params.id, { products: body.products, menus: body.menus }));
});
