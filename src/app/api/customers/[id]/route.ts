import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { customerSchema } from "@/server/schemas";
import { getCustomerCard, upsertCustomer } from "@/server/services/customers";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("customers.manage");
  return ok(await getCustomerCard(ctx.establishment.id, params.id));
});
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("customers.manage");
  const body = await parseBody(req, customerSchema);
  return ok(await upsertCustomer(actorFrom(ctx), { id: params.id, ...body, email: body.email || null }));
});
