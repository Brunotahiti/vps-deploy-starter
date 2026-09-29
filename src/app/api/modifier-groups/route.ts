import { route, parseBody, ok, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { modifierGroupSchema } from "@/server/schemas";
import { listModifierGroups, upsertModifierGroup } from "@/server/services/catalog";

export const GET = route(async () => {
  const ctx = await requirePermission("catalog.view");
  return ok(await listModifierGroups(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("catalog.manage");
  return created(await upsertModifierGroup(actorFrom(ctx), await parseBody(req, modifierGroupSchema)));
});
