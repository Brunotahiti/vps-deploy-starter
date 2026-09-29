import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { getFloorStatus } from "@/server/services/floor";

export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  return ok(await getFloorStatus(ctx.establishment.id));
});
