import { route, ok, created, parseBody } from "@/server/http";
import { requireScreens } from "@/server/screens-auth";
import { actorFrom } from "@/server/auth/authorize";
import { screenSchema } from "@/server/schemas";
import { listScreens, upsertScreen } from "@/server/services/screens";

export const GET = route(async () => {
  const ctx = await requireScreens();
  return ok(await listScreens(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requireScreens();
  return created(await upsertScreen(actorFrom(ctx), await parseBody(req, screenSchema)));
});
