import { route, parseBody, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { cashOpenSchema } from "@/server/schemas";
import { openSession } from "@/server/services/cash";

export const POST = route(async (req) => {
  const ctx = await requirePermission("cash.open");
  return created(await openSession(actorFrom(ctx), await parseBody(req, cashOpenSchema)));
});
