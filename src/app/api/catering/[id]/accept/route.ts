import { route, ok } from "@/server/http";
import { requireCatering } from "@/server/catering-auth";
import { actorFrom } from "@/server/auth/authorize";
import { acceptQuote } from "@/server/services/catering";

/** Devis confirmé par le restaurant (signé sur papier, accord par téléphone). */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireCatering("manage");
  return ok(await acceptQuote(actorFrom(ctx), params.id));
});
