import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { receiveSchema } from "@/server/schemas";
import { receivePurchaseOrder } from "@/server/services/stock";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  const body = await parseBody(req, receiveSchema);
  return ok(await receivePurchaseOrder(actorFrom(ctx), params.id, body.lines));
});
