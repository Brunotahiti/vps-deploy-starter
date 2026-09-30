import { route, ok, parseQuery } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { periodQuery } from "@/server/schemas";
import { getStats } from "@/server/services/stats";

/** Statistiques complètes d'une période (ventes, personnel, cuisine, réservations, clients, faits marquants). */
export const GET = route(async (req) => {
  const ctx = await requirePermission("reports.view");
  const q = parseQuery(req, periodQuery);
  return ok(await getStats(ctx.establishment.id, q.from, q.to, ctx.establishment.timezone));
});
