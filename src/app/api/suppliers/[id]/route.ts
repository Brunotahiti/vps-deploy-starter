import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { supplierSchema } from "@/server/schemas";
import { archiveSupplier, upsertSupplier } from "@/server/services/stock";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  const body = await parseBody(req, supplierSchema.partial().required({ name: true }));
  return ok(await upsertSupplier(actorFrom(ctx), { id: params.id, ...body, email: body.email === "" ? null : body.email }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  await archiveSupplier(actorFrom(ctx), params.id);
  return ok({ archived: true });
});
