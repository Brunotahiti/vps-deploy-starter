import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { revokeBox } from "@/server/box/boxes";

export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("settings.manage");
  await revokeBox(actorFrom(ctx), params.id);
  return ok({ revoked: true });
});
