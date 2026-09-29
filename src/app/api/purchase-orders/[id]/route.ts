import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { purchaseOrderUpdateSchema } from "@/server/schemas";
import { getPurchaseOrder, updatePurchaseOrder } from "@/server/services/stock";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("stock.view");
  return ok(await getPurchaseOrder(ctx.establishment.id, params.id));
});
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  return ok(await updatePurchaseOrder(actorFrom(ctx), params.id, await parseBody(req, purchaseOrderUpdateSchema)));
});
