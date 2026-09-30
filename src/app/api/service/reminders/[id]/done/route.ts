import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { completeReminder } from "@/server/services/service-tracking";

export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("pos.use");
  return ok(await completeReminder(actorFrom(ctx), params.id));
});
