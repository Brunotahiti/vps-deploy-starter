import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { listServices } from "@/server/services/options";

/** Services ponctuels : saisie de la carte, mise en place, formation, pack matériel. */
export const GET = route(async () => {
  const ctx = await requirePermission("settings.manage");
  return ok(await listServices(ctx.organizationId));
});
