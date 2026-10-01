import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom, authorizeSensitive } from "@/server/auth/authorize";
import { paymentsSchema } from "@/server/schemas";
import { addPayments } from "@/server/services/payments";
import { withIdempotency } from "@/server/idempotency";
import { openDrawerAfterPayment } from "@/server/hardware/printers";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, paymentsSchema);
  // "Offert" est une remise à 100 % : nécessite la permission remise ou un PIN manager
  const actor = body.payments.some((p) => p.method === "COMPLIMENTARY") ? await authorizeSensitive(ctx, "pos.discount", body.managerPin) : actorFrom(ctx);
  return withIdempotency(req, ctx.establishment.id, async () => {
    const result = await addPayments(actor, params.id, body.payments);
    // Tiroir-caisse : ouvert pour les moyens qui le demandent (espèces par défaut), seulement pour les paiements réellement créés
    if (result.payments.length) await openDrawerAfterPayment(actor, [...new Set(result.payments.map((p) => p.method))]);
    return ok(result);
  });
});
