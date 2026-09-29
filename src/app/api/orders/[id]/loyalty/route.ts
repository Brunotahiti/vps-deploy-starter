import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { redeemSchema } from "@/server/schemas";
import { redeemReward } from "@/server/services/customers";

/** Utilise une ou plusieurs récompenses fidélité : remise sur la commande. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, redeemSchema).catch(() => ({ rewards: 1 }));
  return ok(await redeemReward(actorFrom(ctx), params.id, body.rewards ?? 1));
});
