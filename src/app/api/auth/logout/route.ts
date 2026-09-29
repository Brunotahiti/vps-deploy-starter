import { route, ok } from "@/server/http";
import { clearSessionCookie, destroySession, getSessionToken } from "@/server/auth/session";

export const POST = route(async () => {
  const token = await getSessionToken();
  if (token) await destroySession(token);
  await clearSessionCookie();
  return ok({ loggedOut: true });
});
