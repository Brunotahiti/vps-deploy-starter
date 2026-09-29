import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { productUpdateSchema } from "@/server/schemas";
import { deleteProduct, getProduct, updateProduct } from "@/server/services/catalog";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("catalog.view");
  return ok(await getProduct(ctx.establishment.id, params.id));
});
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("catalog.manage");
  return ok(await updateProduct(actorFrom(ctx), params.id, await parseBody(req, productUpdateSchema)));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("catalog.manage");
  await deleteProduct(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
