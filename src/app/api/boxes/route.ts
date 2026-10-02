import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission, requireOption } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { boxSchema } from "@/server/schemas";
import { assertOwner, createBox, listBoxes } from "@/server/box/boxes";
import { assertNotDemoAccount } from "@/server/services/demo";

export const GET = route(async () => {
  const ctx = await requirePermission("settings.manage");
  return ok(await listBoxes(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  await assertNotDemoAccount(ctx.organizationId);
  assertOwner(ctx);
  requireOption(ctx, "advanced");
  return created(await createBox(actorFrom(ctx), await parseBody(req, boxSchema)));
});
