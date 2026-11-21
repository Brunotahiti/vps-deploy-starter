import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { authorizeSensitive } from "@/server/auth/authorize";
import { adjustPointsSchema } from "@/server/schemas";
import { adjustPoints } from "@/server/services/customers";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("customers.manage");
  const body = await parseBody(req, adjustPointsSchema);
  // Des points se transforment en remise : comme une remise, droit « remise » ou PIN d'un manager
  const actor = await authorizeSensitive(ctx, "pos.discount", body.managerPin);
  return ok(await adjustPoints(actor, params.id, body.points, body.reason));
});
