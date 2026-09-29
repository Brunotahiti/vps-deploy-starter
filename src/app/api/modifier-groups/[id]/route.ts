import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { modifierGroupSchema } from "@/server/schemas";
import { deleteModifierGroup, upsertModifierGroup } from "@/server/services/catalog";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("catalog.manage");
  return ok(await upsertModifierGroup(actorFrom(ctx), { id: params.id, ...(await parseBody(req, modifierGroupSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("catalog.manage");
  await deleteModifierGroup(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
