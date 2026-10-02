import { rememberOfflineKey, resetOfflineKeys } from "./offline-pass";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { hashPassword, hashPin, randomToken, sha256, verifyPassword, verifyPin } from "@/server/auth/password";
import { createSession, requestMeta, setSessionCookie, setTerminalCookie } from "@/server/auth/session";
import { hasPermission, type PermissionKey } from "@/lib/permissions";
import { reserveAttempt } from "@/server/auth/attempts";
import { assertPinAvailable, pinEstablishmentsOfUser } from "./pin-unique";
import { assertEmailAllowed } from "@/server/auth/guards";
import { audit } from "@/server/audit";
import { slugify } from "@/lib/slug";
import { OFFER } from "@/lib/plan";
import { businessTypeSettings, type BusinessType } from "@/lib/options";
import { ensureSystemRoles } from "./roles";
import { createEstablishmentDefaults } from "./establishments";
import { sendSignupAlert, sendWelcomeEmail } from "./platform-emails";

const PASSWORD_LIMIT = 8;         // échecs par e-mail / 15 min
const PASSWORD_IP_LIMIT = 30;     // échecs par adresse IP / 15 min
const PIN_LIMIT = 12;             // échecs par établissement / 15 min (tous terminaux confondus)
const WINDOW = 15 * 60_000;

let dummyHash: Promise<string> | null = null;

export async function loginWithPassword(email: string, password: string, establishmentId?: string) {
  const meta = await requestMeta().catch(() => ({ ip: null, userAgent: null })); // hors requête (tests) : pas d'adresse
  // Par adresse IP (essais sur de nombreux comptes) puis par compte
  const releaseIp = await reserveAttempt(`pw-ip:${meta.ip ?? "?"}`, PASSWORD_IP_LIMIT, WINDOW);
  const release = await reserveAttempt(`pw:${email.toLowerCase()}`, PASSWORD_LIMIT, WINDOW);
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { organization: { select: { blockedAt: true } } } });
  // Même durée de vérification que le compte existe ou non : la réponse ne révèle pas les adresses inscrites
  const valid = await verifyPassword(password, user?.passwordHash ?? (await (dummyHash ??= hashPassword(randomToken(16)))));
  if (!user || !user.isActive || !valid) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "Email ou mot de passe incorrect");
  }
  await release();
  await releaseIp();
  assertNotBlocked(user.organization.blockedAt);
  const { token } = await createSession({ userId: user.id, establishmentId: establishmentId ?? null, ...meta, via: "password" });
  await setSessionCookie(token);
  return user;
}

/** Compte bloqué depuis la console plateforme : connexion refusée avec un message clair. */
export function assertNotBlocked(blockedAt: Date | null) {
  if (blockedAt) throw new ApiError(403, "ACCOUNT_BLOCKED", `Ce compte est suspendu. Contactez ${OFFER.contactEmail} pour le réactiver.`);
}

/** Connexion rapide par PIN sur un terminal enregistré (établissement lié au terminal). */
export async function loginWithPin(establishmentId: string, pin: string, terminalId: string | null) {
  const release = await reserveAttempt(`pin:${establishmentId}`, PIN_LIMIT, WINDOW, "Trop de PIN erronés sur cet établissement, réessayez dans quelques minutes");
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
  const est = await prisma.establishment.findUnique({ where: { id: establishmentId }, select: { organization: { select: { blockedAt: true } } } });
  assertNotBlocked(est?.organization.blockedAt ?? null);
  // Tous les candidats sont vérifiés : un PIN partagé par deux personnes (créé avant l'unicité) ne doit pas ouvrir la mauvaise session
  const matches = [];
  for (const u of candidates) if (await verifyPin(pin, u.pinHash)) matches.push(u);
  if (!matches.length) throw new ApiError(401, "INVALID_PIN", "PIN incorrect");
  if (matches.length > 1) { await release(); throw new ApiError(409, "PIN_SHARED", "Ce PIN est utilisé par plusieurs personnes : demandez à un manager de le changer"); }
  const matched = matches[0];
  await release();
  await rememberOfflineKey(matched.id, establishmentId, pin).catch(() => {}); // connexion par PIN possible hors ligne
  const meta = await requestMeta();
  const { token } = await createSession({ userId: matched.id, establishmentId, terminalId, ...meta, via: "pin" });
  await setSessionCookie(token);
  return matched;
}

/**
 * Autorisation manager par PIN pour une opération sensible.
 * Retourne l'utilisateur ayant autorisé (pour le journal d'audit).
 */
export async function authorizeWithManagerPin(establishmentId: string, pin: string, permission: PermissionKey) {
  const release = await reserveAttempt(`pin:${establishmentId}`, PIN_LIMIT, WINDOW, "Trop de PIN erronés sur cet établissement, réessayez dans quelques minutes");
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
      await release();
      await rememberOfflineKey(u.id, establishmentId, pin).catch(() => {}); // autorisation manager possible hors ligne
      return u;
    }
    await release(); // PIN correct, simplement sans la permission : ce n'est pas une tentative de devinette
    throw new ApiError(403, "PIN_NOT_AUTHORIZED", "Ce PIN n'a pas l'autorisation requise");
  }
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
  businessType?: BusinessType;
}) {
  const email = input.email.toLowerCase();
  assertEmailAllowed(email); // adresses des administrateurs de la plateforme : réservées
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new ApiError(409, "EMAIL_TAKEN", "Un compte existe déjà avec cet email");

  const baseSlug = slugify(input.organizationName);
  let slug = baseSlug;
  for (let i = 2; await prisma.organization.findUnique({ where: { slug } }); i++) slug = `${baseSlug}-${i}`;

  const passwordHash = await hashPassword(input.password);
  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: input.organizationName, slug, plan: "TRIAL", trialEndsAt: new Date(Date.now() + OFFER.trialDays * 86_400_000) } }); // essai gratuit
    const owner = await tx.user.create({
      data: { organizationId: org.id, email, passwordHash, firstName: input.firstName, lastName: input.lastName, isOwner: true },
    });
    await ensureSystemRoles(org.id, tx);
    const businessType = input.businessType ?? "restaurant";
    const est = await tx.establishment.create({
      data: { organizationId: org.id, name: input.establishmentName, slug: slugify(input.establishmentName), businessType, settings: businessTypeSettings(businessType) as object },
    });
    await createEstablishmentDefaults(est.id, tx);
    return { org, owner, est };
  });
  await audit({ organizationId: result.org.id, establishmentId: result.est.id, userId: result.owner.id, action: "org.signup", entityType: "organization", entityId: result.org.id });
  // E-mail de bienvenue (journalisé dans la console plateforme), sans bloquer l'inscription
  void sendWelcomeEmail(result.org.id).catch(() => {});
  // Alerte à l'équipe ManaResto (PLATFORM_NOTIFY_EMAILS ou contact@manaresto.com)
  void sendSignupAlert(result.org.id).catch((e) => console.error("[inscription] alerte non envoyée", e));
  const meta = await requestMeta();
  const { token } = await createSession({ userId: result.owner.id, establishmentId: result.est.id, ...meta, via: "signup" });
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
  await assertPinAvailable(pin, { establishmentIds: await pinEstablishmentsOfUser(userId), userId, guardKey: userId });
  await prisma.user.update({ where: { id: userId }, data: { pinHash: await hashPin(pin) } });
  await resetOfflineKeys(userId, pin);
}
