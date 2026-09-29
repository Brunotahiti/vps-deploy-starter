import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { webhookSchema } from "@/server/schemas";
import { deleteWebhook, updateWebhook } from "@/server/webhooks";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("settings.manage");
  return ok(await updateWebhook(actorFrom(ctx), params.id, await parseBody(req, webhookSchema.partial())));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("settings.manage");
  await deleteWebhook(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
