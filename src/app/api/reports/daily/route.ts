import { z } from "zod";
import { route, parseQuery, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { daySchema } from "@/server/schemas";
import { getDailySummary } from "@/server/services/reports";
import { localDay } from "@/lib/dates";

export const GET = route(async (req) => {
  const ctx = await requirePermission("reports.view");
  const { day } = parseQuery(req, z.object({ day: daySchema.optional() }));
  const tz = ctx.establishment.timezone;
  return ok(await getDailySummary(ctx.establishment.id, day ?? localDay(new Date(), tz), tz));
});
