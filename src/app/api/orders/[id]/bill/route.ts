import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { requestBill } from "@/server/services/orders";

export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("pos.use");
  return ok(await requestBill(actorFrom(ctx), params.id));
});
