import { route, parseBody, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { tableSchema } from "@/server/schemas";
import { upsertTable } from "@/server/services/floor";

export const POST = route(async (req) => {
  const ctx = await requirePermission("floor.manage");
  return created(await upsertTable(actorFrom(ctx), await parseBody(req, tableSchema)));
});
