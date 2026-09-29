import { route, parseBody, ok, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { kitchenStationSchema } from "@/server/schemas";
import { listKitchenStations, upsertKitchenStation } from "@/server/services/catalog";

export const GET = route(async () => {
  const ctx = await requirePermission("catalog.view");
  return ok(await listKitchenStations(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  return created(await upsertKitchenStation(actorFrom(ctx), await parseBody(req, kitchenStationSchema)));
});
