import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { adjustPointsSchema } from "@/server/schemas";
import { adjustPoints } from "@/server/services/customers";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("customers.manage");
  const body = await parseBody(req, adjustPointsSchema);
  return ok(await adjustPoints(actorFrom(ctx), params.id, body.points, body.reason));
});
