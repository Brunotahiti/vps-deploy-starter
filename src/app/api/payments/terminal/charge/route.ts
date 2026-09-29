import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { terminalChargeSchema } from "@/server/schemas";
import { chargeOnTerminal } from "@/server/hardware/payment-terminal";

/** Lance la transaction sur le TPE connecté ; le paiement est ensuite enregistré avec la référence renvoyée. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, terminalChargeSchema);
  return ok(await chargeOnTerminal(actorFrom(ctx), body.orderId, body.amount));
});
