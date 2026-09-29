import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { cancelPurchaseOrder } from "@/server/services/stock";

export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  return ok(await cancelPurchaseOrder(actorFrom(ctx), params.id));
});
