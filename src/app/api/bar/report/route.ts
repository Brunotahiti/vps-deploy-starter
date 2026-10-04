import { route, ok } from "@/server/http";
import { requireBar } from "@/server/bar-auth";
import { localDay, addDays } from "@/lib/dates";
import { barReport } from "@/server/services/bar";

const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Rapport du bar sur une période (7 derniers jours par défaut). */
export const GET = route(async (req) => {
  const ctx = await requireBar("manage");
  const tz = ctx.establishment.timezone;
  const today = localDay(new Date(), tz);
  const q = req.nextUrl.searchParams;
  const to = day(q.get("to")) ?? today;
  const from = day(q.get("from")) ?? addDays(to, -6);
  return ok(await barReport(ctx.establishment.id, tz, from <= to ? from : to, to));
});
