import { route, ok, parseQuery } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { movementsQuery } from "@/server/schemas";
import { listMovements } from "@/server/services/stock";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("stock.view");
  const q = parseQuery(req, movementsQuery);
  return ok(await listMovements(ctx.establishment.id, { ingredientId: params.id, kind: q.kind, take: q.take }));
});
