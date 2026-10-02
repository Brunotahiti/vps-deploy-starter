import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission, requireOption } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { webhookSchema } from "@/server/schemas";
import { WEBHOOK_EVENTS, createWebhook, listWebhooks } from "@/server/webhooks";
import { assertNotDemoAccount } from "@/server/services/demo";

export const GET = route(async () => {
  const ctx = await requirePermission("settings.manage");
  requireOption(ctx, "advanced");
  return ok({ webhooks: await listWebhooks(ctx.establishment.id), events: WEBHOOK_EVENTS });
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  await assertNotDemoAccount(ctx.organizationId);
  requireOption(ctx, "advanced");
  return created(await createWebhook(actorFrom(ctx), await parseBody(req, webhookSchema)));
});
