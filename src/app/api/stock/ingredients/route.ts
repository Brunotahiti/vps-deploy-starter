import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { ingredientSchema } from "@/server/schemas";
import { listIngredients, upsertIngredient } from "@/server/services/stock";

export const GET = route(async (req) => {
  const ctx = await requirePermission("stock.view");
  return ok(await listIngredients(ctx.establishment.id, { includeInactive: req.nextUrl.searchParams.get("all") === "1" }));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("stock.manage");
  return created(await upsertIngredient(actorFrom(ctx), await parseBody(req, ingredientSchema)));
});
