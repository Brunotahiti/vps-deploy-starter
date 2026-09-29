import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { layoutSchema } from "@/server/schemas";
import { saveLayout } from "@/server/services/floor";

export const PUT = route(async (req) => {
  const ctx = await requirePermission("floor.manage");
  const { tables } = await parseBody(req, layoutSchema);
  await saveLayout(actorFrom(ctx), tables);
  return ok({ saved: tables.length });
});
