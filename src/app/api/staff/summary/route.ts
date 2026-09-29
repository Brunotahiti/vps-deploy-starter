import { route, ok, parseQuery } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { periodQuery } from "@/server/schemas";
import { staffSummary } from "@/server/services/staff";

export const GET = route(async (req) => {
  const ctx = await requirePermission("staff.manage");
  const q = parseQuery(req, periodQuery);
  return ok(await staffSummary(ctx.establishment.id, q.from, q.to, ctx.establishment.timezone));
});
