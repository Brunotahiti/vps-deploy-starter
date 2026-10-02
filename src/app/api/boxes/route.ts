import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { boxSchema } from "@/server/schemas";
import { createBox, listBoxes } from "@/server/box/boxes";

export const GET = route(async () => {
  const ctx = await requirePermission("settings.manage");
  return ok(await listBoxes(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  return created(await createBox(actorFrom(ctx), await parseBody(req, boxSchema)));
});
