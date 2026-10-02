import { route, ok, parseBody } from "@/server/http";
import { requireMarketing } from "@/server/marketing-auth";
import { actorFrom } from "@/server/auth/authorize";
import { giftCardCancelSchema } from "@/server/schemas";
import { cancelGiftCard } from "@/server/services/marketing";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireMarketing("manage");
  return ok(await cancelGiftCard(actorFrom(ctx), params.id, (await parseBody(req, giftCardCancelSchema)).reason));
});
