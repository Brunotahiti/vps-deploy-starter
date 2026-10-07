import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { takeawayBoard } from "@/server/services/takeaway";

export const dynamic = "force-dynamic";

/** File « À emporter » : à accepter, en préparation, prêtes à remettre. `?tables=1` (portail Salle, mode roulotte) : aussi les commandes à table. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("pos.use");
  return ok(await takeawayBoard(ctx.establishment.id, new Date(), { withTables: req.nextUrl.searchParams.get("tables") === "1" }));
});
