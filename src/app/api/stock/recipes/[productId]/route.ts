import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { recipeSchema } from "@/server/schemas";
import { getRecipe, setRecipe } from "@/server/services/stock";

export const GET = route<{ productId: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("stock.view");
  return ok(await getRecipe(ctx.establishment.id, params.productId));
});
export const PUT = route<{ productId: string }>(async (req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  const body = await parseBody(req, recipeSchema);
  return ok(await setRecipe(actorFrom(ctx), params.productId, body.lines, { applyCost: body.applyCost }));
});
