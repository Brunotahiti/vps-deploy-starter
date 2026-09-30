import { cookies } from "next/headers";
import { route, ok } from "@/server/http";
import { clearSessionCookie, destroySession, getSessionToken } from "@/server/auth/session";

export const POST = route(async () => {
  const token = await getSessionToken();
  if (token) await destroySession(token);
  await clearSessionCookie();
  // Fin d'une éventuelle prise en main : le jeton de retour vers la console ne doit pas survivre à la déconnexion
  (await cookies()).set("mr_platform", "", { httpOnly: true, path: "/", maxAge: 0 });
  return ok({ loggedOut: true });
});
