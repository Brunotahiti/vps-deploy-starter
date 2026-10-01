import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { terminalChargeSchema } from "@/server/schemas";
import { chargeOnTerminal } from "@/server/hardware/payment-terminal";
import { withIdempotency } from "@/server/idempotency";

/**
 * Lance la transaction sur le TPE connecté et enregistre aussitôt le paiement carte avec la référence renvoyée.
 * Clé d'idempotence obligatoire côté caisse : un double appui ou une nouvelle tentative réseau ne débite pas deux fois.
 */
export const POST = route(async (req) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, terminalChargeSchema);
  return withIdempotency(req, ctx.establishment.id, async () => ok(await chargeOnTerminal(actorFrom(ctx), body.orderId, body.amount, { paymentId: body.paymentId, splitLabel: body.splitLabel })));
});
