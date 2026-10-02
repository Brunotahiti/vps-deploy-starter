import { cookies, headers } from "next/headers";
import { prisma } from "@/server/db";
import { randomToken, sha256 } from "./password";
import { resolveClientIp } from "@/server/net/client-ip";
import { parseAdminEmails } from "@/lib/platform";
import { recordAppEvent, type LoginMethod } from "@/server/services/site-traffic";

export const SESSION_COOKIE = "mr_session";
export const TERMINAL_COOKIE = "mr_terminal";

function ttlMs() {
  const hours = Number(process.env.SESSION_TTL_HOURS ?? "12");
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 3600 * 1000;
}

export async function createSession(opts: {
  userId: string;
  establishmentId?: string | null;
  terminalId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  impersonatorId?: string | null; // console plateforme : « prendre la main »
  ttlMs?: number;
  scope?: "pos" | null; // session limitée à la caisse de son établissement
  boxId?: string | null;
  /** Statistiques de fréquentation : mode de connexion (inscription et démo comptées à part). */
  via?: LoginMethod | "signup" | "demo";
}) {
  const token = randomToken(32);
  const session = await prisma.session.create({
    data: {
      userId: opts.userId,
      tokenHash: sha256(token),
      establishmentId: opts.establishmentId ?? null,
      terminalId: opts.terminalId ?? null,
      ip: opts.ip ?? null,
      userAgent: opts.userAgent?.slice(0, 255) ?? null,
      impersonatorId: opts.impersonatorId ?? null,
      scope: opts.scope ?? null,
      boxId: opts.boxId ?? null,
      expiresAt: new Date(Date.now() + (opts.ttlMs ?? ttlMs())),
    },
  });
  // Une prise en main par le support ne compte pas comme une connexion du restaurateur
  if (!opts.impersonatorId) await prisma.user.update({ where: { id: opts.userId }, data: { lastLoginAt: new Date() } });
  if (opts.via && !opts.impersonatorId) {
    const kind = opts.via === "signup" || opts.via === "demo" ? opts.via : "login";
    await recordAppEvent(kind, { userId: opts.userId, method: kind === "login" ? opts.via : null, ua: opts.userAgent });
  }
  return { session, token };
}

export async function setSessionCookie(token: string, maxAgeMs = ttlMs()) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

async function impersonatorStillAdmin(id: string) {
  const admin = await prisma.user.findUnique({ where: { id }, select: { email: true, isActive: true } });
  return !!admin?.isActive && parseAdminEmails(process.env.PLATFORM_ADMIN_EMAILS).includes(admin.email.toLowerCase());
}

export async function findSessionByToken(token: string) {
  const found = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { include: { organization: { select: { blockedAt: true } } } } },
  });
  if (!found || found.expiresAt < new Date() || !found.user.isActive) return null;
  // Prise en main par le support : l'administrateur doit l'être encore (actif et toujours dans PLATFORM_ADMIN_EMAILS)
  if (found.impersonatorId && !(await impersonatorStillAdmin(found.impersonatorId))) return null;
  // Compte bloqué depuis la console plateforme : seules les prises en main du support restent possibles
  if (found.user.organization.blockedAt && !found.impersonatorId) return null;
  const { organization: _org, ...user } = found.user;
  void _org;
  const session = { ...found, user };
  // Rafraîchir lastSeenAt au plus toutes les 5 minutes pour limiter les écritures
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return session;
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function switchSessionEstablishment(sessionId: string, establishmentId: string) {
  await prisma.session.update({ where: { id: sessionId }, data: { establishmentId } });
}

export async function requestMeta() {
  const h = await headers();
  return {
    ip: resolveClientIp((n) => h.get(n)),
    userAgent: h.get("user-agent"),
  };
}

/** Terminal enregistré sur l'appareil (cookie longue durée). */
export async function getTerminalFromCookie() {
  const store = await cookies();
  const key = store.get(TERMINAL_COOKIE)?.value;
  if (!key) return null;
  const found = await prisma.terminal.findUnique({ where: { deviceKeyHash: sha256(key) }, include: { establishment: { select: { isActive: true, name: true, organization: { select: { blockedAt: true } } } } } });
  if (!found || !found.isActive || !found.establishment.isActive || found.establishment.organization.blockedAt) return null;
  const { establishment, ...terminal } = found;
  return { ...terminal, establishmentName: establishment.name };
}

export async function setTerminalCookie(deviceKey: string) {
  const store = await cookies();
  store.set(TERMINAL_COOKIE, deviceKey, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 3600,
  });
}

export async function clearTerminalCookie() {
  const store = await cookies();
  store.set(TERMINAL_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}
