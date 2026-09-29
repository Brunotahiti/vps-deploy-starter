import { route, ok, created, parseBody, parseQuery } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { movementSchema, movementsQuery } from "@/server/schemas";
import { addMovement, listMovements } from "@/server/services/stock";

/** Journal des mouvements (filtres : ingrédient, type, période) et saisie manuelle (perte, casse, ajustement, achat direct). */
export const GET = route(async (req) => {
  const ctx = await requirePermission("stock.view");
  const q = parseQuery(req, movementsQuery);
  return ok(await listMovements(ctx.establishment.id, { ingredientId: q.ingredientId, kind: q.kind, from: q.from ? new Date(q.from) : undefined, to: q.to ? new Date(q.to) : undefined, take: q.take }));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("stock.manage");
  return created(await addMovement(actorFrom(ctx), await parseBody(req, movementSchema)));
});
