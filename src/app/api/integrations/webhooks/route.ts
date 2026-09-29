import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { webhookSchema } from "@/server/schemas";
import { WEBHOOK_EVENTS, createWebhook, listWebhooks } from "@/server/webhooks";

export const GET = route(async () => {
  const ctx = await requirePermission("settings.manage");
  return ok({ webhooks: await listWebhooks(ctx.establishment.id), events: WEBHOOK_EVENTS });
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  return created(await createWebhook(actorFrom(ctx), await parseBody(req, webhookSchema)));
});
