import { route, ok, parseBody } from "@/server/http";
import { requireMarketing } from "@/server/marketing-auth";
import { actorFrom } from "@/server/auth/authorize";
import { reviewSettingsSchema } from "@/server/schemas";
import { reviewSettings, saveReviewSettings } from "@/server/services/marketing";

export const GET = route(async () => {
  const ctx = await requireMarketing("manage");
  return ok(await reviewSettings(ctx.establishment.id));
});
export const PUT = route(async (req) => {
  const ctx = await requireMarketing("manage");
  return ok(await saveReviewSettings(actorFrom(ctx), (await parseBody(req, reviewSettingsSchema)).reviewUrl));
});
