import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { categorySchema } from "@/server/schemas";
import { deleteCategory, upsertCategory } from "@/server/services/catalog";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("catalog.manage");
  const body = await parseBody(req, categorySchema.partial().required({ name: true }));
  return ok(await upsertCategory(actorFrom(ctx), { id: params.id, ...body }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("catalog.manage");
  await deleteCategory(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
