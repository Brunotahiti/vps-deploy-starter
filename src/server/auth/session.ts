import { cookies, headers } from "next/headers";
import { prisma } from "@/server/db";
import { randomToken, sha256 } from "./password";

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
      expiresAt: new Date(Date.now() + ttlMs()),
    },
  });
  await prisma.user.update({ where: { id: opts.userId }, data: { lastLoginAt: new Date() } });
  return { session, token };
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Math.floor(ttlMs() / 1000),
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

export async function findSessionByToken(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;
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
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    userAgent: h.get("user-agent"),
  };
}

/** Terminal enregistré sur l'appareil (cookie longue durée). */
export async function getTerminalFromCookie() {
  const store = await cookies();
  const key = store.get(TERMINAL_COOKIE)?.value;
  if (!key) return null;
  const terminal = await prisma.terminal.findUnique({ where: { deviceKeyHash: sha256(key) } });
  if (!terminal || !terminal.isActive) return null;
  return terminal;
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
