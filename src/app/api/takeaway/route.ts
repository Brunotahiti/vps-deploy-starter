import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { takeawayBoard } from "@/server/services/takeaway";

export const dynamic = "force-dynamic";

/** File « À emporter » : à accepter, en préparation, prêtes à remettre. */
export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  return ok(await takeawayBoard(ctx.establishment.id));
});
