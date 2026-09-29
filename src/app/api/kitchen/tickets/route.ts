import { route, ok, parseQuery } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { kitchenListQuery } from "@/server/schemas";
import { listKitchenTickets } from "@/server/services/kitchen";

/** Tickets cuisine actifs (option : poste, terminés récents). */
export const GET = route(async (req) => {
  const ctx = await requirePermission("kds.use");
  const q = parseQuery(req, kitchenListQuery);
  return ok(await listKitchenTickets(ctx.establishment.id, { stationId: q.stationId ?? null, includeDone: q.includeDone === "1" || q.includeDone === "true" }));
});
