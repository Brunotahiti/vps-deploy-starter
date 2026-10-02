import { route, ok, created, parseBody, parseQuery } from "@/server/http";
import { requireHygiene } from "@/server/hygiene-auth";
import { actorFrom } from "@/server/auth/authorize";
import { hygieneRangeQuery, temperatureReadingSchema } from "@/server/schemas";
import { listReadings, recordReading } from "@/server/services/hygiene";
import { addDays, endOfLocalDay, localDay, startOfLocalDay } from "@/lib/dates";

/** Relevés de la période (7 derniers jours par défaut). */
export const GET = route(async (req) => {
  const ctx = await requireHygiene("record");
  const tz = ctx.establishment.timezone;
  const q = parseQuery(req, hygieneRangeQuery);
  const to = q.to ?? localDay(new Date(), tz);
  const from = q.from ?? addDays(to, -6);
  return ok(await listReadings(ctx.establishment.id, startOfLocalDay(from, tz), endOfLocalDay(to, tz)));
});
export const POST = route(async (req) => {
  const ctx = await requireHygiene("record");
  return created(await recordReading(actorFrom(ctx), await parseBody(req, temperatureReadingSchema)));
});
