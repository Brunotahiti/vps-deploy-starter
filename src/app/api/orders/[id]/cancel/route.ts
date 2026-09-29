import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { authorizeSensitive } from "@/server/auth/authorize";
import { cancelSchema } from "@/server/schemas";
import { cancelOrder } from "@/server/services/orders";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, cancelSchema);
  const actor = await authorizeSensitive(ctx, "pos.cancel_order", body.managerPin);
  return ok(await cancelOrder(actor, params.id, body.reason));
});
