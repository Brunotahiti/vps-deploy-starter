import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { absenceSchema } from "@/server/schemas";
import { deleteAbsence, upsertAbsence } from "@/server/services/planning";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("staff.manage");
  return ok(await upsertAbsence(actorFrom(ctx), { id: params.id, ...(await parseBody(req, absenceSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("staff.manage");
  await deleteAbsence(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
