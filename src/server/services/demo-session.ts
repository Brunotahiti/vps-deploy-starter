/**
 * « Session en live » : visite du restaurant exemple (Le Mana Beach) depuis son propre compte.
 * La session de la personne est mise de côté dans un cookie à part (comme la prise en main du support) ;
 * « Revenir à mon restaurant » la restaure, sans avoir à se reconnecter.
 */
import { cookies } from "next/headers";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { createSession, destroySession, findSessionByToken, getSessionToken, requestMeta, setSessionCookie } from "@/server/auth/session";
import { DEMO_ORG_SLUG } from "@/lib/platform";

export const DEMO_RETURN_COOKIE = "mr_return";
const DEMO_TTL = 4 * 3600_000; // une visite dure au plus 4 heures

const clearReturn = async () => (await cookies()).set(DEMO_RETURN_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });

async function demoOwner() {
  const owner = await prisma.user.findFirst({
    where: { isOwner: true, isActive: true, organization: { slug: DEMO_ORG_SLUG } },
    orderBy: { createdAt: "asc" },
    select: { id: true, organization: { select: { establishments: { where: { isActive: true }, orderBy: { createdAt: "asc" }, take: 1, select: { id: true } } } } },
  });
  if (!owner) throw new ApiError(503, "DEMO_UNAVAILABLE", "Le restaurant exemple est momentanément indisponible");
  return { id: owner.id, establishmentId: owner.organization.establishments[0]?.id ?? null };
}

/** Le compte de la personne qui visite le restaurant exemple, s'il a été mis de côté et reste valide. */
export async function findReturnSession() {
  const token = (await cookies()).get(DEMO_RETURN_COOKIE)?.value;
  if (!token) return null;
  const s = await findSessionByToken(token);
  return s && !s.impersonatorId ? { token, session: s } : null;
}

/** Ouvre le restaurant exemple. Connecté : sa session est gardée pour y revenir ; sinon simple visite. */
export async function openDemoSession() {
  const current = await getSessionToken();
  const mine = current ? await findSessionByToken(current) : null;
  if (mine?.impersonatorId) throw new ApiError(409, "IMPERSONATING", "Terminez d'abord la prise en main du compte (bandeau violet)");
  const demo = await demoOwner();
  if (mine?.userId === demo.id) return { returnTo: !!(await findReturnSession()) }; // déjà dans le restaurant exemple
  const meta = await requestMeta();
  const { token } = await createSession({ userId: demo.id, establishmentId: demo.establishmentId, ttlMs: DEMO_TTL, ...meta, via: "demo" });
  const store = await cookies();
  if (mine && current) {
    // Sa session reste valide côté serveur ; le cookie expire avec elle
    store.set(DEMO_RETURN_COOKIE, current, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: Math.max(60, Math.floor((mine.expiresAt.getTime() - Date.now()) / 1000)) });
  } else await clearReturn();
  await setSessionCookie(token, DEMO_TTL);
  return { returnTo: !!mine };
}

/** Fin de visite : ferme la session du restaurant exemple et restaure celle de la personne. */
export async function returnFromDemo() {
  const back = await findReturnSession();
  if (!back) { await clearReturn(); throw new ApiError(401, "RETURN_EXPIRED", "Votre session a expiré : reconnectez-vous à votre compte"); }
  const current = await getSessionToken();
  if (current && current !== back.token) {
    const s = await findSessionByToken(current);
    const demo = await demoOwner().catch(() => null);
    if (s && demo && s.userId === demo.id) await destroySession(current);
  }
  await setSessionCookie(back.token, Math.max(60_000, back.session.expiresAt.getTime() - Date.now()));
  await clearReturn();
}
