import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { employeeSchema } from "@/server/schemas";
import { archiveEmployee, upsertEmployee } from "@/server/services/staff";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("staff.manage");
  return ok(await upsertEmployee(actorFrom(ctx), { id: params.id, ...(await parseBody(req, employeeSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("staff.manage");
  await archiveEmployee(actorFrom(ctx), params.id);
  return ok({ archived: true });
});
