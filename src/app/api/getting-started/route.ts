import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { gettingStarted } from "@/server/services/getting-started";

export const dynamic = "force-dynamic";

/** Étapes « Bien démarrer » de l'établissement (tableau de bord). */
export const GET = route(async () => {
  const ctx = await requirePermission("reports.view");
  return ok(await gettingStarted(ctx.establishment.id, ctx.user.id));
});
