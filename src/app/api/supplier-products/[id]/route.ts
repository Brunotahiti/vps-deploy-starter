import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { supplierProductSchema } from "@/server/schemas";
import { deleteSupplierProduct, upsertSupplierProduct } from "@/server/services/stock";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  return ok(await upsertSupplierProduct(actorFrom(ctx), { id: params.id, ...(await parseBody(req, supplierProductSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  await deleteSupplierProduct(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
