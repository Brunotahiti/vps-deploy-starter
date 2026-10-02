import { route, parseBody, ok } from "@/server/http";
import { can, requirePermission } from "@/server/auth/context";
import { ApiError } from "@/server/errors";
import { actorFrom, authorizeSensitive } from "@/server/auth/authorize";
import { paymentsSchema } from "@/server/schemas";
import { addPayments } from "@/server/services/payments";
import { withIdempotency } from "@/server/idempotency";
import { openDrawerAfterPayment } from "@/server/hardware/printers";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, paymentsSchema);
  // « Sur compte » : droit de mettre sur le compte d'un client pro (option Comptes clients)
  if (body.payments.some((p) => p.method === "ACCOUNT") && !can(ctx, "accounts.charge")) throw new ApiError(403, "FORBIDDEN", "Permission requise : accounts.charge", { permission: "accounts.charge" });
  // "Offert" est une remise à 100 % : nécessite la permission remise ou un PIN manager
  const actor = body.payments.some((p) => p.method === "COMPLIMENTARY") ? await authorizeSensitive(ctx, "pos.discount", body.managerPin) : actorFrom(ctx);
  return withIdempotency(req, ctx.establishment.id, async () => {
    const offlineReplay = req.headers.get("x-offline-replay") === "1";
    const result = await addPayments(actor, params.id, body.payments, { offlineReplay });
    // Tiroir-caisse : ouvert pour les moyens qui le demandent (espèces par défaut), seulement pour les paiements réellement créés.
    // Jamais au rejeu d'un encaissement fait hors ligne : le tiroir s'est ouvert à ce moment-là (agent local), pas au retour du réseau.
    if (result.payments.length && !offlineReplay) await openDrawerAfterPayment(actor, [...new Set(result.payments.map((p) => p.method))]);
    return ok(result);
  });
});
