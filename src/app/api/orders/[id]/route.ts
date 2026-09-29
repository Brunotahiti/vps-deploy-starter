import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { orderUpdateSchema } from "@/server/schemas";
import { getOrder, updateOrder } from "@/server/services/orders";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("pos.use");
  return ok(await getOrder(ctx.establishment.id, params.id));
});
export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  return ok(await updateOrder(actorFrom(ctx), params.id, await parseBody(req, orderUpdateSchema)));
});
