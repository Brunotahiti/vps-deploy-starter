import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { supplierProductSchema } from "@/server/schemas";
import { listSupplierProducts, upsertSupplierProduct } from "@/server/services/stock";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("stock.view");
  return ok(await listSupplierProducts(ctx.establishment.id, params.id));
});
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  const body = await parseBody(req, supplierProductSchema.omit({ supplierId: true }));
  return created(await upsertSupplierProduct(actorFrom(ctx), { ...body, supplierId: params.id }));
});
