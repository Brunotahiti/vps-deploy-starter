import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { listKitchenChanges } from "@/server/services/kitchen-changes";

/** Écran cuisine : modifications et annulations envoyées par la salle */
export const GET = route(async (req) => {
  const ctx = await requirePermission("kds.use");
  return ok(await listKitchenChanges(ctx.establishment.id, req.nextUrl.searchParams.get("stationId")));
});
