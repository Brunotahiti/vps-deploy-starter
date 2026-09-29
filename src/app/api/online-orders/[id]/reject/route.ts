import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { rejectSchema } from "@/server/schemas";
import { rejectOnlineOrder } from "@/server/services/public";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const { reason } = await parseBody(req, rejectSchema);
  return ok(await rejectOnlineOrder(actorFrom(ctx), params.id, reason));
});
