import { route, parseBody, ok, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { menuSchema } from "@/server/schemas";
import { listMenus, upsertMenu } from "@/server/services/catalog";

export const GET = route(async (req) => {
  const ctx = await requirePermission("catalog.view");
  return ok(await listMenus(ctx.establishment.id, req.nextUrl.searchParams.get("all") === "1"));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("catalog.manage");
  return created(await upsertMenu(actorFrom(ctx), await parseBody(req, menuSchema)));
});
