import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { kitchenStationSchema } from "@/server/schemas";
import { upsertKitchenStation } from "@/server/services/catalog";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("settings.manage");
  return ok(await upsertKitchenStation(actorFrom(ctx), { id: params.id, ...(await parseBody(req, kitchenStationSchema)) }));
});
