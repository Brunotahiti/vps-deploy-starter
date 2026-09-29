import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { authorizeSensitive } from "@/server/auth/authorize";
import { refundSchema } from "@/server/schemas";
import { refundPayment } from "@/server/services/payments";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, refundSchema);
  const actor = await authorizeSensitive(ctx, "pos.refund", body.managerPin);
  return ok(await refundPayment(actor, params.id, body));
});
