import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { getOrCreateCounterDraft } from "@/server/services/orders";

/** Mode roulotte : la commande comptoir en cours sur cet appareil, ou une nouvelle. */
export const POST = route(async () => {
  const ctx = await requirePermission("pos.use");
  return ok(await getOrCreateCounterDraft(actorFrom(ctx)));
});
