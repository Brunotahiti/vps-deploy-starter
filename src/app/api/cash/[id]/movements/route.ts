import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { authorizeSensitive } from "@/server/auth/authorize";
import { cashMovementSchema } from "@/server/schemas";
import { addMovement } from "@/server/services/cash";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, cashMovementSchema);
  const actor = await authorizeSensitive(ctx, body.kind === "CORRECTION" ? "cash.correct" : "cash.movement", body.managerPin);
  return ok(await addMovement(actor, params.id, body));
});
