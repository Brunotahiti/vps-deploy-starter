import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { serviceSettingsSchema } from "@/server/schemas";
import { serviceSettings, updateServiceSettings, DEFAULT_STEPS, DEFAULT_DELAYS } from "@/server/services/service-tracking";

export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  return ok({ ...(await serviceSettings(ctx.establishment.id)), defaults: { steps: DEFAULT_STEPS, delays: DEFAULT_DELAYS } });
});
export const PATCH = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  return ok(await updateServiceSettings(actorFrom(ctx), await parseBody(req, serviceSettingsSchema)));
});
