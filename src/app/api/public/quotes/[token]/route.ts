import { route, ok } from "@/server/http";
import { rateLimitIp } from "@/server/rate-limit";
import { publicQuote } from "@/server/services/catering";

/** Devis consulté par le client depuis le lien reçu (sans connexion). */
export const GET = route<{ token: string }>(async (req, { params }) => {
  await rateLimitIp(req, "quote-view", 60);
  return ok(await publicQuote(params.token));
});
