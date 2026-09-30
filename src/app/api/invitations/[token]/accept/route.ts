import { route, ok, parseBody } from "@/server/http";
import { rateLimitIp } from "@/server/rate-limit";
import { acceptInviteSchema } from "@/server/schemas";
import { acceptInvitation } from "@/server/services/invitations";
import { createSession, requestMeta, setSessionCookie } from "@/server/auth/session";

/** Accepte l'invitation (mot de passe + PIN) et ouvre directement la session. */
export const POST = route<{ token: string }>(async (req, { params }) => {
  rateLimitIp(req, "invitation-accept", 10);
  const body = await parseBody(req, acceptInviteSchema);
  const { user, establishmentId } = await acceptInvitation(params.token, body);
  const meta = await requestMeta();
  const { token } = await createSession({ userId: user.id, establishmentId, ...meta });
  await setSessionCookie(token);
  return ok({ id: user.id, email: user.email });
});
