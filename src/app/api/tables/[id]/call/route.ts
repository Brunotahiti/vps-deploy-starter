import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { clearCall } from "@/server/services/public";

/** Le serveur a pris en charge l'appel de la table. */
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("pos.use");
  await clearCall(actorFrom(ctx), params.id);
  return ok({ cleared: true });
});
