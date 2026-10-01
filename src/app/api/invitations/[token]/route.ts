import { route, ok } from "@/server/http";
import { rateLimitIp } from "@/server/rate-limit";
import { getInvitation } from "@/server/services/invitations";

export const dynamic = "force-dynamic";
/** Détail public d'une invitation (prénom, entreprise, rôles, expiration). */
export const GET = route<{ token: string }>(async (req, { params }) => {
  await rateLimitIp(req, "invitation", 30);
  return ok(await getInvitation(params.token));
});
