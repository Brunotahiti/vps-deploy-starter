import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { orderTimeline } from "@/server/services/service-tracking";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("pos.use");
  return ok(await orderTimeline(ctx.establishment.id, params.id));
});
