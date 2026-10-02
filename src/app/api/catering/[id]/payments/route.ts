import { route, ok, parseBody } from "@/server/http";
import { requireCatering } from "@/server/catering-auth";
import { actorFrom } from "@/server/auth/authorize";
import { eventPaymentSchema } from "@/server/schemas";
import { recordEventPayment } from "@/server/services/catering";

/** Acompte, solde ou remboursement. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireCatering("manage");
  return ok(await recordEventPayment(actorFrom(ctx), params.id, await parseBody(req, eventPaymentSchema)));
});
