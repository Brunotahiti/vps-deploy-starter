import { route, ok, parseBody } from "@/server/http";
import { rateLimitIp } from "@/server/rate-limit";
import { quoteAcceptSchema } from "@/server/schemas";
import { acceptPublicQuote } from "@/server/services/catering";

/** Acceptation du devis en ligne par le client. */
export const POST = route<{ token: string }>(async (req, { params }) => {
  await rateLimitIp(req, "quote-accept", 10);
  const { name } = await parseBody(req, quoteAcceptSchema);
  return ok(await acceptPublicQuote(params.token, name));
});
