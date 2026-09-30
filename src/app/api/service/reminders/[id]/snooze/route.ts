import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { snoozeSchema } from "@/server/schemas";
import { snoozeReminder } from "@/server/services/service-tracking";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, snoozeSchema);
  return ok(await snoozeReminder(actorFrom(ctx), params.id, body.minutes));
});
