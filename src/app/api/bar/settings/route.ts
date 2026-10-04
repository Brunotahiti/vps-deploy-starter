import { route, ok, parseBody } from "@/server/http";
import { requireBar } from "@/server/bar-auth";
import { actorFrom } from "@/server/auth/authorize";
import { barSettingsSchema } from "@/server/schemas";
import { barSettings, updateBarSettings } from "@/server/services/bar";

/** Créneaux de happy hour. */
export const GET = route(async () => {
  const ctx = await requireBar("use");
  return ok(await barSettings(ctx.establishment.id));
});
export const PUT = route(async (req) => {
  const ctx = await requireBar("manage");
  return ok(await updateBarSettings(actorFrom(ctx), await parseBody(req, barSettingsSchema)));
});
