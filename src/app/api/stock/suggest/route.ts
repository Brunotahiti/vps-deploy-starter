import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { suggestPurchase } from "@/server/services/stock";

export const GET = route(async () => {
  const ctx = await requirePermission("stock.view");
  return ok(await suggestPurchase(ctx.establishment.id));
});
