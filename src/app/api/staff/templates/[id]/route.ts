import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { shiftTemplateSchema } from "@/server/schemas";
import { deleteShiftTemplate, upsertShiftTemplate } from "@/server/services/planning";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("staff.manage");
  return ok(await upsertShiftTemplate(actorFrom(ctx), { id: params.id, ...(await parseBody(req, shiftTemplateSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("staff.manage");
  return ok(await deleteShiftTemplate(actorFrom(ctx), params.id));
});
