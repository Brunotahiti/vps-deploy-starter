import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { attachCustomerSchema } from "@/server/schemas";
import { attachCustomer } from "@/server/services/customers";

/** Rattache (ou détache) un client à la commande pour la fidélité et l'historique. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const { customerId } = await parseBody(req, attachCustomerSchema);
  return ok(await attachCustomer(actorFrom(ctx), params.id, customerId));
});
