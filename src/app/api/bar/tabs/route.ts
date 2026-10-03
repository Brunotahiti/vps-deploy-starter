import { route, ok, created, parseBody } from "@/server/http";
import { requireBar } from "@/server/bar-auth";
import { can } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { ApiError } from "@/server/errors";
import { tabCreateSchema } from "@/server/schemas";
import { createTab, listTabs } from "@/server/services/bar";

/** Ardoises ouvertes au comptoir. */
export const GET = route(async () => {
  const ctx = await requireBar("use");
  return ok(await listTabs(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requireBar("use");
  if (!can(ctx, "pos.use")) throw new ApiError(403, "FORBIDDEN", "Permission requise : pos.use", { permission: "pos.use" });
  return created(await createTab(actorFrom(ctx), await parseBody(req, tabCreateSchema)));
});
