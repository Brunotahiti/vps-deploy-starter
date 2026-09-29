import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { customerSchema } from "@/server/schemas";
import { listCustomers, upsertCustomer } from "@/server/services/customers";

export const GET = route(async (req) => {
  const ctx = await requirePermission("customers.manage");
  return ok(await listCustomers(ctx.organizationId, { search: req.nextUrl.searchParams.get("search") ?? undefined, establishmentId: ctx.establishment.id, take: Number(req.nextUrl.searchParams.get("take") ?? 100) }));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("customers.manage");
  const body = await parseBody(req, customerSchema);
  return created(await upsertCustomer(actorFrom(ctx), { ...body, email: body.email || null }));
});
