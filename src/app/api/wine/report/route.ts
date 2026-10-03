import { route, ok } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { localDay, addDays } from "@/lib/dates";
import { wineReport } from "@/server/services/wine";

const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Rapport de la cave à vin : ventes, marges, pertes, vins dormants (30 derniers jours par défaut). */
export const GET = route(async (req) => {
  const ctx = await requireWine("manage");
  const tz = ctx.establishment.timezone;
  const q = req.nextUrl.searchParams;
  const to = day(q.get("to")) ?? localDay(new Date(), tz);
  const from = day(q.get("from")) ?? addDays(to, -29);
  return ok(await wineReport(ctx.establishment.id, tz, from <= to ? from : to, to));
});
