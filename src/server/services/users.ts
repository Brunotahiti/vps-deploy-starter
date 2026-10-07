import { resetOfflineKeys, revokeOfflinePasses } from "./offline-pass";
import { prisma } from "@/server/db";
import { assertPinAvailable, pinEstablishmentsOfUser } from "./pin-unique";
import { ApiError } from "@/server/errors";
import { hashPassword, hashPin, randomToken } from "@/server/auth/password";
import { audit } from "@/server/audit";

/** Domaine interne des comptes « PIN seul » : l'adresse n'existe pas, elle n'est jamais affichée ni utilisée pour se connecter. */
export const PIN_ONLY_DOMAIN = "pin.manaresto.local";
export const isPinOnlyEmail = (email: string) => email.toLowerCase().endsWith(`@${PIN_ONLY_DOMAIN}`);

export async function listUsers(organizationId: string, establishmentId?: string) {
  return prisma.user.findMany({
    where: {
      organizationId,
      ...(establishmentId ? { OR: [{ isOwner: true }, { memberships: { some: { establishmentId } } }] } : {}),
    },
    select: {
      id: true, email: true, firstName: true, lastName: true, displayName: true, color: true, isOwner: true, isActive: true, pinOnly: true,
      lastLoginAt: true, createdAt: true, pinHash: true, inviteToken: true, inviteExpiresAt: true, invitedAt: true,
      memberships: { include: { role: { select: { id: true, key: true, name: true } }, establishment: { select: { id: true, name: true } } } },
    },
    orderBy: [{ isOwner: "desc" }, { lastName: "asc" }],
  }).then((users) => users.map(({ pinHash, inviteToken, ...u }) => ({ ...u, email: u.pinOnly ? "" : u.email, hasPin: !!pinHash, invitePending: !!inviteToken, inviteExpired: !!inviteToken && !!u.inviteExpiresAt && u.inviteExpiresAt.getTime() < Date.now() })));
}

export type CreatePinUserInput = { firstName: string; lastName: string; displayName?: string | null; color?: string | null; pin: string; memberships: { establishmentId: string; roleId: string }[] };

/**
 * Compte employé « PIN seul » : prénom, nom, profil et PIN, c'est tout. Pas d'e-mail ni de mot de passe à retenir :
 * la personne se connecte en touchant son nom puis son PIN sur les terminaux de l'établissement.
 * (Une adresse interne inutilisable et un mot de passe aléatoire sont posés pour respecter le modèle de compte.)
 */
export async function createPinUser(organizationId: string, actorId: string, input: CreatePinUserInput) {
  await assertMembershipsInOrg(organizationId, input.memberships);
  if (!/^\d{4,6}$/.test(input.pin)) throw new ApiError(400, "INVALID_PIN", "Le PIN doit contenir 4 à 6 chiffres");
  await assertPinAvailable(input.pin, { establishmentIds: input.memberships.map((m) => m.establishmentId), guardKey: actorId });
  const email = `${randomToken(12)}@${PIN_ONLY_DOMAIN}`;
  const user = await prisma.user.create({
    data: {
      organizationId, email, passwordHash: await hashPassword(randomToken(24)), pinOnly: true, firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null, color: input.color ?? null, pinHash: await hashPin(input.pin), memberships: { create: input.memberships },
    },
  });
  await resetOfflineKeys(user.id, input.pin);
  await audit({ organizationId, userId: actorId, action: "user.create", entityType: "user", entityId: user.id, newValue: { pinOnly: true, memberships: input.memberships } });
  return user;
}

/**
 * Équipe d'un établissement pour l'écran PIN d'un terminal : prénoms, couleurs et profil des personnes qui ont un PIN.
 * Public (la tablette n'est pas encore connectée) : aucune adresse ni donnée sensible.
 */
export async function pinTeam(establishmentId: string) {
  const users = await prisma.user.findMany({
    where: { isActive: true, pinHash: { not: null }, OR: [{ memberships: { some: { establishmentId } } }, { isOwner: true, organization: { establishments: { some: { id: establishmentId } } } }] },
    select: { id: true, firstName: true, lastName: true, displayName: true, color: true, isOwner: true, lastLoginAt: true, memberships: { where: { establishmentId }, select: { role: { select: { key: true, name: true } } } } },
    orderBy: [{ lastLoginAt: { sort: "desc", nulls: "last" } }, { firstName: "asc" }],
  });
  return users.map((u) => ({ id: u.id, name: u.displayName || u.firstName, initials: `${u.firstName.slice(0, 1)}${u.lastName.slice(0, 1)}`.toUpperCase(), color: u.color, roleKey: u.isOwner ? "owner" : u.memberships[0]?.role.key ?? null, roleName: u.isOwner ? "Propriétaire" : u.memberships[0]?.role.name ?? null }));
}

export type CreateUserInput = {
  email: string; password: string; firstName: string; lastName: string; displayName?: string | null; color?: string | null;
  pin?: string | null; memberships: { establishmentId: string; roleId: string }[];
};

export async function createUser(organizationId: string, actorId: string, input: CreateUserInput) {
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw new ApiError(409, "EMAIL_TAKEN", "Cet email est déjà utilisé");
  await assertMembershipsInOrg(organizationId, input.memberships);
  if (input.pin && !/^\d{4,6}$/.test(input.pin)) throw new ApiError(400, "INVALID_PIN", "Le PIN doit contenir 4 à 6 chiffres");
  if (input.pin) await assertPinAvailable(input.pin, { establishmentIds: input.memberships.map((m) => m.establishmentId), guardKey: actorId });
  const user = await prisma.user.create({
    data: {
      organizationId, email, passwordHash: await hashPassword(input.password), firstName: input.firstName, lastName: input.lastName,
      displayName: input.displayName ?? null, color: input.color ?? null, pinHash: input.pin ? await hashPin(input.pin) : null,
      memberships: { create: input.memberships },
    },
  });
  if (input.pin) await resetOfflineKeys(user.id, input.pin);
  await audit({ organizationId, userId: actorId, action: "user.create", entityType: "user", entityId: user.id, newValue: { email, memberships: input.memberships } });
  return user;
}

export type UpdateUserInput = Partial<Omit<CreateUserInput, "email">> & { isActive?: boolean; email?: string };

export async function updateUser(organizationId: string, actorId: string, userId: string, input: UpdateUserInput) {
  const before = await prisma.user.findFirst({ where: { id: userId, organizationId }, include: { memberships: true } });
  if (!before) throw new ApiError(404, "NOT_FOUND", "Utilisateur introuvable");
  if (before.isOwner && input.isActive === false) throw new ApiError(400, "OWNER", "Le propriétaire ne peut pas être désactivé");
  if (input.memberships) await assertMembershipsInOrg(organizationId, input.memberships);
  if (input.pin && !/^\d{4,6}$/.test(input.pin)) throw new ApiError(400, "INVALID_PIN", "Le PIN doit contenir 4 à 6 chiffres");
  if (input.pin) {
    const establishmentIds = before.isOwner ? await pinEstablishmentsOfUser(userId) : (input.memberships ?? before.memberships).map((m) => m.establishmentId);
    await assertPinAvailable(input.pin, { establishmentIds, userId, guardKey: actorId });
  }
  const user = await prisma.$transaction(async (tx) => {
    if (input.memberships) {
      await tx.userEstablishment.deleteMany({ where: { userId } });
      await tx.userEstablishment.createMany({ data: input.memberships.map((m) => ({ userId, ...m })) });
    }
    return tx.user.update({
      where: { id: userId },
      data: {
        email: input.email?.toLowerCase(), firstName: input.firstName, lastName: input.lastName, displayName: input.displayName,
        color: input.color, isActive: input.isActive,
        // Un compte « PIN seul » qui reçoit une vraie adresse devient un compte complet (mot de passe à définir pour l'utiliser)
        ...(before.pinOnly && input.email ? { pinOnly: false } : {}),
        ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
        ...(input.pin ? { pinHash: await hashPin(input.pin) } : {}),
      },
    });
  });
  // Connexion hors ligne : nouveau PIN → nouvelles clés ; compte désactivé ou retiré d'un établissement → laissez-passer révoqués
  if (input.pin) await resetOfflineKeys(userId, input.pin);
  if (input.isActive === false) await revokeOfflinePasses(userId);
  else if (input.memberships && !before.isOwner) {
    const kept = new Set(input.memberships.map((m) => m.establishmentId));
    const removed = before.memberships.map((m) => m.establishmentId).filter((id) => !kept.has(id));
    if (removed.length) await revokeOfflinePasses(userId, removed);
  }
  await audit({
    organizationId, userId: actorId, action: "user.update", entityType: "user", entityId: userId,
    oldValue: { firstName: before.firstName, lastName: before.lastName, isActive: before.isActive, memberships: before.memberships.map((m) => ({ establishmentId: m.establishmentId, roleId: m.roleId })) },
    newValue: { firstName: user.firstName, lastName: user.lastName, isActive: user.isActive, memberships: input.memberships, passwordChanged: !!input.password, pinChanged: !!input.pin },
  });
  return user;
}

async function assertMembershipsInOrg(organizationId: string, memberships: { establishmentId: string; roleId: string }[]) {
  for (const m of memberships) {
    const est = await prisma.establishment.findFirst({ where: { id: m.establishmentId, organizationId }, select: { id: true } });
    const role = await prisma.role.findFirst({ where: { id: m.roleId, organizationId }, select: { id: true, key: true } });
    if (!est || !role) throw new ApiError(400, "BAD_MEMBERSHIP", "Établissement ou rôle invalide");
    if (role.key === "owner") throw new ApiError(400, "OWNER_ROLE", "Le rôle Propriétaire ne s'attribue pas manuellement");
  }
}
