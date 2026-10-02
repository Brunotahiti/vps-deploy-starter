import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { copyCatalogSchema } from "@/server/schemas";
import { copyCatalog } from "@/server/services/organization";
import { ApiError } from "@/server/errors";

/** Copie le catalogue d'un établissement source vers l'établissement :id. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("establishments.manage");
  const body = await parseBody(req, copyCatalogSchema);
  // Seulement entre des établissements auxquels le compte a accès (le propriétaire les a tous)
  const mine = new Set(ctx.establishments.map((e) => e.id));
  if (!mine.has(body.fromId) || !mine.has(params.id)) throw new ApiError(403, "FORBIDDEN", "Accès refusé à l'un des établissements");
  return ok(await copyCatalog(actorFrom(ctx), body.fromId, params.id, { products: body.products, menus: body.menus }));
});
