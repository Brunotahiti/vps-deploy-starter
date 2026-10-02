import { route, ok } from "@/server/http";
import { requirePermission, requireOption } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { revokeApiKey } from "@/server/api-keys";

export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("settings.manage");
  requireOption(ctx, "advanced");
  await revokeApiKey(actorFrom(ctx), params.id);
  return ok({ revoked: true });
});
