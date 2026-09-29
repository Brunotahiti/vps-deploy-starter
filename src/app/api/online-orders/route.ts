import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { listOnlineOrders } from "@/server/services/public";

export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  return ok(await listOnlineOrders(ctx.establishment.id));
});
