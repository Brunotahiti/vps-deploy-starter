import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { acceptOnlineOrder } from "@/server/services/public";

export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("pos.use");
  return ok(await acceptOnlineOrder(actorFrom(ctx), params.id));
});
