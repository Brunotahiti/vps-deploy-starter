import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { purchaseOrderSchema } from "@/server/schemas";
import { createPurchaseOrder, listPurchaseOrders } from "@/server/services/stock";
import type { PurchaseOrderStatus } from "@/generated/prisma/client";

export const GET = route(async (req) => {
  const ctx = await requirePermission("stock.view");
  const status = req.nextUrl.searchParams.get("status") as PurchaseOrderStatus | null;
  return ok(await listPurchaseOrders(ctx.establishment.id, { status: status ?? undefined }));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("stock.manage");
  return created(await createPurchaseOrder(actorFrom(ctx), await parseBody(req, purchaseOrderSchema)));
});
