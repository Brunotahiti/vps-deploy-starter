import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { menuSchema } from "@/server/schemas";
import { deleteMenu, upsertMenu } from "@/server/services/catalog";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("catalog.manage");
  return ok(await upsertMenu(actorFrom(ctx), { id: params.id, ...(await parseBody(req, menuSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("catalog.manage");
  await deleteMenu(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
