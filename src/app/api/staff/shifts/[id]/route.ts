import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { shiftSchema } from "@/server/schemas";
import { deleteShift, upsertShift } from "@/server/services/staff";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("staff.manage");
  return ok(await upsertShift(actorFrom(ctx), { id: params.id, ...(await parseBody(req, shiftSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("staff.manage");
  await deleteShift(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
