import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { tableSchema } from "@/server/schemas";
import { deleteTable, upsertTable } from "@/server/services/floor";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("floor.manage");
  return ok(await upsertTable(actorFrom(ctx), { id: params.id, ...(await parseBody(req, tableSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("floor.manage");
  await deleteTable(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
