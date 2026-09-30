import { cookies } from "next/headers";
import { route, ok } from "@/server/http";
import { ApiError } from "@/server/errors";
import { destroySession, findSessionByToken, getSessionToken, setSessionCookie } from "@/server/auth/session";
import { isPlatformAdminEmail } from "@/server/auth/platform";

const PLATFORM_COOKIE = "mr_platform";

/** Fin de prise en main : ferme la session du restaurant et restaure la session de l'administrateur. */
export const POST = route(async () => {
  const store = await cookies();
  const adminToken = store.get(PLATFORM_COOKIE)?.value;
  if (!adminToken) throw new ApiError(400, "NO_ADMIN_SESSION", "Aucune session d'administration à restaurer");
  const admin = await findSessionByToken(adminToken);
  if (!admin || admin.impersonatorId || !isPlatformAdminEmail(admin.user.email)) {
    store.set(PLATFORM_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    throw new ApiError(401, "ADMIN_SESSION_EXPIRED", "Session d'administration expirée, reconnectez-vous");
  }
  const current = await getSessionToken();
  if (current) {
    const s = await findSessionByToken(current);
    if (s?.impersonatorId === admin.userId) await destroySession(current);
  }
  await setSessionCookie(adminToken, Math.max(60_000, admin.expiresAt.getTime() - Date.now()));
  store.set(PLATFORM_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return ok({ redirect: "/platform" });
});
