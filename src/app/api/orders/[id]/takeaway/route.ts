import { route, parseBody, ok } from "@/server/http";
import { can, requireEstablishment } from "@/server/auth/context";
import { ApiError } from "@/server/errors";
import { actorFrom } from "@/server/auth/authorize";
import { takeawayStepSchema } from "@/server/schemas";
import { setTakeawayStep } from "@/server/services/takeaway";

/** À emporter : commande prête (appel du numéro), pas encore prête, ou remise au client. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireEstablishment();
  if (!can(ctx, "pos.use") && !can(ctx, "kds.use")) throw new ApiError(403, "FORBIDDEN", "Permission requise : pos.use ou kds.use");
  const body = await parseBody(req, takeawayStepSchema);
  return ok(await setTakeawayStep(actorFrom(ctx), params.id, body.step));
});
