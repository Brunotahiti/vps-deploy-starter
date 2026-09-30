import { cookies } from "next/headers";
import { route, ok } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { createSession, getSessionToken, requestMeta, setSessionCookie } from "@/server/auth/session";
import { impersonationTarget } from "@/server/services/platform";

const PLATFORM_COOKIE = "mr_platform";
const TTL = 2 * 3600_000; // une prise en main dure au plus 2 heures

/** « Prendre la main » : ouvre une session sur le compte du propriétaire, la session admin est mise de côté. */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePlatformAdmin();
  const adminToken = await getSessionToken();
  if (!adminToken) throw new ApiError(401, "UNAUTHENTICATED", "Authentification requise");
  const { owner, establishmentId } = await impersonationTarget(params.id);
  const meta = await requestMeta();
  const { token } = await createSession({ userId: owner.id, establishmentId, impersonatorId: ctx.user.id, ttlMs: TTL, ...meta });
  const store = await cookies();
  store.set(PLATFORM_COOKIE, adminToken, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL / 1000 });
  await setSessionCookie(token, TTL);
  await audit({ organizationId: params.id, establishmentId, action: "platform.impersonate", entityType: "user", entityId: owner.id, reason: `Console ManaResto (${ctx.user.email}) : prise en main du compte` });
  return ok({ redirect: "/admin" });
});
