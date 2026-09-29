import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { timeEntrySchema } from "@/server/schemas";
import { deleteEntry, upsertEntry } from "@/server/services/staff";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("staff.manage");
  return ok(await upsertEntry(actorFrom(ctx), { id: params.id, ...(await parseBody(req, timeEntrySchema)) }));
});
export const DELETE = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("staff.manage");
  const reason = req.nextUrl.searchParams.get("reason") || "Suppression";
  await deleteEntry(actorFrom(ctx), params.id, reason);
  return ok({ deleted: true });
});
