import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { kitchenTicketStatusSchema } from "@/server/schemas";
import { setTicketStatus } from "@/server/services/kitchen";

/** ACCEPTER / EN PRÉPARATION / PRÊT / TERMINÉ (rappel : DONE → READY). */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("kds.use");
  const { status } = await parseBody(req, kitchenTicketStatusSchema);
  return ok(await setTicketStatus(actorFrom(ctx), params.id, status));
});
