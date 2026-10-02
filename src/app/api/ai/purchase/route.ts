import { z } from "zod";
import { route, ok, created, parseBody } from "@/server/http";
import { requireOption, requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { createProposedOrders, proposePurchase } from "@/server/services/ai-assistant";

/** Commande d'achats proposée (Assistant IA + Stock et recettes) */
export const GET = route(async () => {
  const ctx = await requirePermission("stock.view");
  requireOption(ctx, "ai");
  return ok(await proposePurchase(ctx.establishment.id, ctx.establishment.timezone));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("stock.manage");
  requireOption(ctx, "ai");
  const body = await parseBody(req, z.object({ supplierIds: z.array(z.string().uuid()).max(50).optional() }));
  return created(await createProposedOrders(actorFrom(ctx), ctx.establishment.timezone, body.supplierIds));
});
