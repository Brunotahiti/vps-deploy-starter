import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { kitchenItemReadySchema } from "@/server/schemas";
import { setItemReady } from "@/server/services/kitchen";

/** Coche / décoche un article du ticket comme prêt. */
export const POST = route<{ id: string; itemId: string }>(async (req, { params }) => {
  const ctx = await requirePermission("kds.use");
  const { ready } = await parseBody(req, kitchenItemReadySchema);
  return ok(await setItemReady(actorFrom(ctx), params.id, params.itemId, ready));
});
