import { route, ok, parseQuery } from "@/server/http";
import { requireOption, requirePermission } from "@/server/auth/context";
import { periodQuery } from "@/server/schemas";
import { getPeriodReport } from "@/server/services/reports";

export const GET = route(async (req) => {
  const ctx = await requirePermission("reports.view");
  requireOption(ctx, "stats");
  const q = parseQuery(req, periodQuery);
  return ok(await getPeriodReport(ctx.establishment.id, q.from, q.to, ctx.establishment.timezone));
});
