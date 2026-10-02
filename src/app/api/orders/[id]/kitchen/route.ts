import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { orderKitchenState } from "@/server/services/kitchen-changes";

/** Où en est chaque plat en cuisine, et l'historique de ses modifications */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("pos.use");
  return ok(await orderKitchenState(ctx.establishment.id, params.id));
});
