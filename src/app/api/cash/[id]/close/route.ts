import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { cashCloseSchema } from "@/server/schemas";
import { closeSession } from "@/server/services/cash";
import { openDrawerIfConfigured } from "@/server/hardware/printers";
import { withIdempotency } from "@/server/idempotency";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("cash.close");
  const actor = actorFrom(ctx);
  const body = await parseBody(req, cashCloseSchema);
  return withIdempotency(req, ctx.establishment.id, async () => {
    const report = await closeSession(actor, params.id, body);
    // Clôture : le tiroir s'ouvre pour retirer les espèces comptées (pas au rejeu d'une clôture faite hors ligne)
    if (req.headers.get("x-offline-replay") !== "1") await openDrawerIfConfigured(actor, "cash_close");
    return ok(report);
  });
});
