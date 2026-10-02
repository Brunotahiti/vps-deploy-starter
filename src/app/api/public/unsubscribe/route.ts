import { route, ok, parseBody } from "@/server/http";
import { z } from "zod";
import { unsubscribe } from "@/server/services/marketing";
import { rateLimitIp } from "@/server/rate-limit";

/** Désabonnement depuis le lien d'une campagne (jeton signé, sans connexion). */
export const POST = route(async (req) => {
  await rateLimitIp(req, "unsubscribe", 20);
  const { token } = await parseBody(req, z.object({ token: z.string().min(10).max(120) }));
  return ok(await unsubscribe(token));
});
