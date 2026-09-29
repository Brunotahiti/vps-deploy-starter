import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { ingredientSchema } from "@/server/schemas";
import { archiveIngredient, upsertIngredient } from "@/server/services/stock";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  return ok(await upsertIngredient(actorFrom(ctx), { id: params.id, ...(await parseBody(req, ingredientSchema.partial().required({ name: true }))) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  await archiveIngredient(actorFrom(ctx), params.id);
  return ok({ archived: true });
});
