import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { hashPassword, hashPin, randomToken, sha256, verifyPassword, verifyPin } from "@/server/auth/password";
import { createSession, requestMeta, setSessionCookie, setTerminalCookie } from "@/server/auth/session";
import { hasPermission, type PermissionKey } from "@/lib/permissions";
import { audit } from "@/server/audit";
import { slugify } from "@/lib/slug";
import { ensureSystemRoles } from "./roles";
import { createEstablishmentDefaults } from "./establishments";

const attempts = new Map<string, { count: number; until: number }>();

/** Limitation simple des tentatives (5 échecs → 10 min) par clé (email/ip). */
export function checkRateLimit(key: string) {
  const a = attempts.get(key);
  if (a && a.count >= 5 && a.until > Date.now()) {
    throw new ApiError(429, "RATE_LIMITED", "Trop de tentatives, réessayez dans quelques minutes");
  }
}
export function recordFailure(key: string) {
  const a = attempts.get(key) ?? { count: 0, until: 0 };
  a.count += 1;
  a.until = Date.now() + 10 * 60 * 1000;
  attempts.set(key, a);
}
export function clearFailures(key: string) {
  attempts.delete(key);
}

export async function loginWithPassword(email: string, password: string, establishmentId?: string) {
  const key = `pw:${email.toLowerCase()}`;
  checkRateLimit(key);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.isActive || !(await verifyPassword(password, user.passwordHash))) {
    recordFailure(key);
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email ou mot de passe incorrect");
  }
  clearFailures(key);
  const meta = await requestMeta();
  const { token } = await createSession({ userId: user.id, establishmentId: establishmentId ?? null, ...meta });
  await setSessionCookie(token);
  return user;
}

/** Connexion rapide par PIN sur un terminal enregistré (établissement lié au terminal). */
export async function loginWithPin(establishmentId: string, pin: string, terminalId: string | null) {
  const key = `pin:${establishmentId}`;
  checkRateLimit(key);
  const candidates = await prisma.user.findMany({
    where: {
      isActive: true,
      pinHash: { not: null },
      OR: [
        { memberships: { some: { establishmentId } } },
        { isOwner: true, organization: { establishments: { some: { id: establishmentId } } } },
      ],
    },
  });
  let matched = null;
  for (const u of candidates) {
    if (await verifyPin(pin, u.pinHash)) {
      matched = u;
      break;
    }
  }
  if (!matched) {
    recordFailure(key);
    throw new ApiError(401, "INVALID_PIN", "PIN incorrect");
  }
  clearFailures(key);
  const meta = await requestMeta();
  const { token } = await createSession({ userId: matched.id, establishmentId, terminalId, ...meta });
  await setSessionCookie(token);
  return matched;
}

/**
 * Autorisation manager par PIN pour une opération sensible.
 * Retourne l'utilisateur ayant autorisé (pour le journal d'audit).
 */
export async function authorizeWithManagerPin(establishmentId: string, pin: string, permission: PermissionKey) {
  const key = `mgr:${establishmentId}`;
  checkRateLimit(key);
  const candidates = await prisma.user.findMany({
    where: {
      isActive: true,
      pinHash: { not: null },
      OR: [
        { memberships: { some: { establishmentId } } },
        { isOwner: true, organization: { establishments: { some: { id: establishmentId } } } },
      ],
    },
    include: { memberships: { where: { establishmentId }, include: { role: { include: { permissions: true } } } } },
  });
  for (const u of candidates) {
    if (!(await verifyPin(pin, u.pinHash))) continue;
    const perms = u.isOwner ? ["*"] : (u.memberships[0]?.role.permissions.map((p) => p.permissionKey) ?? []);
    if (hasPermission(perms, permission)) {
      clearFailures(key);
      return u;
    }
    throw new ApiError(403, "PIN_NOT_AUTHORIZED", "Ce PIN n'a pas l'autorisation requise");
  }
  recordFailure(key);
  throw new ApiError(401, "INVALID_PIN", "PIN manager incorrect");
}

/** Inscription : crée l'entreprise, le premier établissement et le propriétaire. */
export async function signup(input: {
  organizationName: string;
  establishmentName: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}) {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ApiError(409, "EMAIL_TAKEN", "Un compte existe déjà avec cet email");

  const baseSlug = slugify(input.organizationName);
  let slug = baseSlug;
  for (let i = 2; await prisma.organization.findUnique({ where: { slug } }); i++) slug = `${baseSlug}-${i}`;

  const passwordHash = await hashPassword(input.password);
  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: input.organizationName, slug } });
    const owner = await tx.user.create({
      data: { organizationId: org.id, email, passwordHash, firstName: input.firstName, lastName: input.lastName, isOwner: true },
    });
    await ensureSystemRoles(org.id, tx);
    const est = await tx.establishment.create({
      data: { organizationId: org.id, name: input.establishmentName, slug: slugify(input.establishmentName) },
    });
    await createEstablishmentDefaults(est.id, tx);
    return { org, owner, est };
  });
  await audit({ organizationId: result.org.id, establishmentId: result.est.id, userId: result.owner.id, action: "org.signup", entityType: "organization", entityId: result.org.id });
  const meta = await requestMeta();
  const { token } = await createSession({ userId: result.owner.id, establishmentId: result.est.id, ...meta });
  await setSessionCookie(token);
  return result;
}

/** Enregistre l'appareil courant comme terminal de l'établissement (cookie longue durée). */
export async function registerTerminal(establishmentId: string, name: string, kind: "POS" | "KDS" | "KIOSK" | "MANAGER") {
  const deviceKey = randomToken(32);
  const terminal = await prisma.terminal.create({
    data: { establishmentId, name, kind, deviceKeyHash: sha256(deviceKey), lastSeenAt: new Date() },
  });
  await setTerminalCookie(deviceKey);
  return terminal;
}

export async function setUserPin(userId: string, pin: string) {
  if (!/^\d{4,6}$/.test(pin)) throw new ApiError(400, "INVALID_PIN", "Le PIN doit contenir 4 à 6 chiffres");
  await prisma.user.update({ where: { id: userId }, data: { pinHash: await hashPin(pin) } });
}
