import { route, parseBody, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { cashOpenSchema } from "@/server/schemas";
import { openSession } from "@/server/services/cash";
import { openDrawerIfConfigured } from "@/server/hardware/printers";

export const POST = route(async (req) => {
  const ctx = await requirePermission("cash.open");
  const actor = actorFrom(ctx);
  const session = await openSession(actor, await parseBody(req, cashOpenSchema));
  // Ouverture de caisse : le tiroir s'ouvre pour y déposer le fond de caisse
  await openDrawerIfConfigured(actor, "cash_open");
  return created(session);
});
