import { route, ok, created, parseBody } from "@/server/http";
import { requireMarketing } from "@/server/marketing-auth";
import { actorFrom } from "@/server/auth/authorize";
import { giftCardSaleSchema } from "@/server/schemas";
import { listGiftCards, sellGiftCard } from "@/server/services/marketing";

export const GET = route(async () => {
  const ctx = await requireMarketing("sell");
  return ok(await listGiftCards(ctx.establishment.id));
});
/** Vente d'une carte cadeau (encaissée maintenant ; en espèces, dans la caisse ouverte). */
export const POST = route(async (req) => {
  const ctx = await requireMarketing("sell");
  return created(await sellGiftCard(actorFrom(ctx), await parseBody(req, giftCardSaleSchema)));
});
