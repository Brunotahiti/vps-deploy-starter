import { cookies } from "next/headers";
import { route, ok } from "@/server/http";
import { clearSessionCookie, destroySession, getSessionToken } from "@/server/auth/session";
import { DEMO_RETURN_COOKIE, findReturnSession } from "@/server/services/demo-session";

export const POST = route(async () => {
  const token = await getSessionToken();
  if (token) await destroySession(token);
  await clearSessionCookie();
  // Fin d'une éventuelle prise en main : le jeton de retour vers la console ne doit pas survivre à la déconnexion
  (await cookies()).set("mr_platform", "", { httpOnly: true, path: "/", maxAge: 0 });
  // Déconnexion pendant la visite du restaurant exemple : la session mise de côté est fermée aussi
  const back = await findReturnSession();
  if (back) await destroySession(back.token);
  (await cookies()).set(DEMO_RETURN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return ok({ loggedOut: true });
});
