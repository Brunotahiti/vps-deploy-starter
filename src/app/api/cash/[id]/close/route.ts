import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { cashCloseSchema } from "@/server/schemas";
import { closeSession } from "@/server/services/cash";
import { openDrawerIfConfigured } from "@/server/hardware/printers";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("cash.close");
  const actor = actorFrom(ctx);
  const report = await closeSession(actor, params.id, await parseBody(req, cashCloseSchema));
  // Clôture : le tiroir s'ouvre pour retirer les espèces comptées
  await openDrawerIfConfigured(actor, "cash_close");
  return ok(report);
});
