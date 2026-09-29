import { route, ok, parseQuery } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { stockReportQuery } from "@/server/schemas";
import { stockReport } from "@/server/services/stock";
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";

export const GET = route(async (req) => {
  const ctx = await requirePermission("stock.view");
  const q = parseQuery(req, stockReportQuery);
  const tz = ctx.establishment.timezone;
  return ok(await stockReport(ctx.establishment.id, startOfLocalDay(q.from, tz), endOfLocalDay(q.to, tz)));
});
