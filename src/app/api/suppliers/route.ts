import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { supplierSchema } from "@/server/schemas";
import { listSuppliers, upsertSupplier } from "@/server/services/stock";

export const GET = route(async (req) => {
  const ctx = await requirePermission("stock.view");
  return ok(await listSuppliers(ctx.establishment.id, req.nextUrl.searchParams.get("all") === "1"));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("stock.manage");
  const body = await parseBody(req, supplierSchema);
  return created(await upsertSupplier(actorFrom(ctx), { ...body, email: body.email || null }));
});
