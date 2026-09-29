import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { cashCloseSchema } from "@/server/schemas";
import { closeSession } from "@/server/services/cash";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("cash.close");
  return ok(await closeSession(actorFrom(ctx), params.id, await parseBody(req, cashCloseSchema)));
});
