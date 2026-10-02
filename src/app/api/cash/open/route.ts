import { route, parseBody, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { cashOpenSchema } from "@/server/schemas";
import { openSession } from "@/server/services/cash";
import { openDrawerIfConfigured } from "@/server/hardware/printers";

export const POST = route(async (req) => {
  const ctx = await requirePermission("cash.open");
  const actor = actorFrom(ctx);
  const session = await openSession(actor, await parseBody(req, cashOpenSchema), { offlineReplay: req.headers.get("x-offline-replay") === "1" });
  // Ouverture de caisse : le tiroir s'ouvre pour y déposer le fond de caisse (pas au rejeu d'une ouverture faite hors ligne)
  if (req.headers.get("x-offline-replay") !== "1") await openDrawerIfConfigured(actor, "cash_open");
  return created(session);
});
