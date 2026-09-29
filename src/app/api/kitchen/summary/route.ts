import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { kitchenSummary } from "@/server/services/kitchen";

export const GET = route(async () => {
  const ctx = await requirePermission("kds.use");
  return ok(await kitchenSummary(ctx.establishment.id));
});
