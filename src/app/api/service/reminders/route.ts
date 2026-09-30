import { route, ok } from "@/server/http";
import { requirePermission, can } from "@/server/auth/context";
import { listReminders } from "@/server/services/service-tracking";

/** Rappels de service ouverts : ses tables pour un serveur, toutes les tables pour un responsable (gestion des utilisateurs). */
export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  return ok(await listReminders(ctx.establishment.id, { userId: ctx.user.id, all: ctx.user.isOwner || can(ctx, "users.manage") }));
});
