import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { authorizeSensitive } from "@/server/auth/authorize";
import { discountSchema } from "@/server/schemas";
import { applyDiscount } from "@/server/services/orders";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, discountSchema);
  const actor = await authorizeSensitive(ctx, "pos.discount", body.managerPin);
  return ok(await applyDiscount(actor, params.id, body));
});
