import { route, ok } from "@/server/http";
import { requirePermission, requireOption } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { testWebhook } from "@/server/webhooks";

export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("settings.manage");
  requireOption(ctx, "advanced");
  return ok(await testWebhook(actorFrom(ctx), params.id));
});
