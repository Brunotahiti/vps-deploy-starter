import { route, ok, parseBody } from "@/server/http";
import { requireCatering } from "@/server/catering-auth";
import { actorFrom } from "@/server/auth/authorize";
import { quoteSendSchema } from "@/server/schemas";
import { sendQuote } from "@/server/services/catering";

/** Envoi du devis par e-mail (PDF + lien d'acceptation) ou simplement marqué « remis au client ». */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireCatering("manage");
  return ok(await sendQuote(actorFrom(ctx), params.id, await parseBody(req, quoteSendSchema)));
});
