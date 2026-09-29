import { z } from "zod";
import { route, parseQuery, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { daySchema } from "@/server/schemas";
import { getRevenueByDay } from "@/server/services/reports";
import { addDays, localDay } from "@/lib/dates";

export const GET = route(async (req) => {
  const ctx = await requirePermission("reports.view");
  const q = parseQuery(req, z.object({ from: daySchema.optional(), to: daySchema.optional() }));
  const tz = ctx.establishment.timezone;
  const to = q.to ?? localDay(new Date(), tz);
  const from = q.from ?? addDays(to, -13);
  return ok(await getRevenueByDay(ctx.establishment.id, from, to, tz));
});
