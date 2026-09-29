import { route, ok, parseQuery } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { periodQuery } from "@/server/schemas";
import { getPeriodReport } from "@/server/services/reports";

export const GET = route(async (req) => {
  const ctx = await requirePermission("reports.view");
  const q = parseQuery(req, periodQuery);
  return ok(await getPeriodReport(ctx.establishment.id, q.from, q.to, ctx.establishment.timezone));
});
