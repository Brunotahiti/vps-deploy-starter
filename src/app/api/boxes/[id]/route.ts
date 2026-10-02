import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { assertOwner, revokeBox } from "@/server/box/boxes";
import { assertNotDemoAccount } from "@/server/services/demo";

export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("settings.manage");
  await assertNotDemoAccount(ctx.organizationId);
  assertOwner(ctx);
  await revokeBox(actorFrom(ctx), params.id);
  return ok({ revoked: true });
});
