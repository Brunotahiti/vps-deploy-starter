import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { listSessions } from "@/server/services/cash";

export const GET = route(async () => {
  const ctx = await requirePermission("reports.view");
  return ok(await listSessions(ctx.establishment.id));
});
