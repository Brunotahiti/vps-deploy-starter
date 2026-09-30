import { route, ok } from "@/server/http";
import { getAuthContext } from "@/server/auth/context";
import { recordActivity } from "@/server/services/platform";

/** Temps d'utilisation : l'application envoie un battement par minute tant qu'elle est ouverte et visible. */
export const POST = route(async () => {
  const ctx = await getAuthContext();
  if (!ctx) return ok({ recorded: false });
  if (ctx.impersonatorId) return ok({ recorded: false }); // le support ne gonfle pas l'activité du restaurant
  await recordActivity(ctx.organizationId, ctx.user.id);
  return ok({ recorded: true });
});
