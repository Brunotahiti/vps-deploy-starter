import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { inventorySchema } from "@/server/schemas";
import { applyInventory } from "@/server/services/stock";

export const POST = route(async (req) => {
  const ctx = await requirePermission("stock.manage");
  const body = await parseBody(req, inventorySchema);
  return ok(await applyInventory(actorFrom(ctx), body.lines, body.reason));
});
