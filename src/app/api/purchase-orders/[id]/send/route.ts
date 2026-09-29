import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { sendPurchaseOrder } from "@/server/services/stock";

export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  return ok(await sendPurchaseOrder(actorFrom(ctx), params.id));
});
