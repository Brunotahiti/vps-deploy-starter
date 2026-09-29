import { z } from "zod";
import { route, ok, parseQuery } from "@/server/http";
import { requireApiKey } from "@/server/api-keys";
import { daySchema } from "@/server/schemas";
import { getDailySummary, getPeriodReport } from "@/server/services/reports";
import { localDay } from "@/lib/dates";

/** API publique v1 — synthèse du jour (`?day=`) ou de période (`?from&to`). */
export const GET = route(async (req) => {
  const ctx = await requireApiKey(req, "reports:read");
  const q = parseQuery(req, z.object({ day: daySchema.optional(), from: daySchema.optional(), to: daySchema.optional() }));
  const tz = ctx.establishment.timezone;
  if (q.from && q.to) return ok(await getPeriodReport(ctx.establishmentId, q.from, q.to, tz));
  return ok(await getDailySummary(ctx.establishmentId, q.day ?? localDay(new Date(), tz), tz));
});
