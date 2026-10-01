import { route, ok } from "@/server/http";
import { rateLimitIp } from "@/server/rate-limit";
import { openDemoSession } from "@/server/services/demo-session";

/** « Voir une session en live » : ouvre le restaurant exemple (la session de la personne est gardée pour y revenir). */
export const POST = route(async (req) => {
  await rateLimitIp(req, "demo-session", 30, 3_600_000);
  return ok(await openDemoSession());
});
