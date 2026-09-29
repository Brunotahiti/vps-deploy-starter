import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { apiKeySchema } from "@/server/schemas";
import { API_SCOPES, createApiKey, listApiKeys } from "@/server/api-keys";

export const GET = route(async () => {
  const ctx = await requirePermission("settings.manage");
  return ok({ keys: await listApiKeys(ctx.establishment.id), scopes: API_SCOPES });
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  return created(await createApiKey(actorFrom(ctx), await parseBody(req, apiKeySchema)));
});
