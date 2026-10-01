import { prisma } from "@/server/db";
import { assertPinAvailable } from "./pin-unique";
import { ApiError } from "@/server/errors";
import { hashPassword, hashPin, randomToken } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { invitationMail, isEmailConfigured, sendMail } from "@/server/email/mailer";
import { isDemoOrganization } from "./demo";

/**
 * Invitations par e-mail : le manager crée le compte avec ses rôles, l'employé reçoit un lien
 * pour choisir son mot de passe et son PIN. Le lien (jeton unique) expire après INVITE_DAYS jours.
 * Sans SMTP configuré, le lien est simplement affiché au manager pour être transmis à la main.
 */
export const INVITE_DAYS = 7;
const baseUrl = () => process.env.PUBLIC_URL?.replace(/\/$/, "") || "";
export const inviteUrl = (token: string) => `${baseUrl()}/invitation/${token}`;

export type InviteInput = { email: string; firstName: string; lastName: string; color?: string | null; memberships: { establishmentId: string; roleId: string }[] };

async function deliver(user: { id: string; email: string; firstName: string; inviteToken: string | null }, organizationId: string, inviterName: string) {
  const [org, memberships] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
    prisma.userEstablishment.findMany({ where: { userId: user.id }, select: { establishment: { select: { name: true } } } }),
  ]);
  const url = inviteUrl(user.inviteToken!);
  let emailSent = false;
  if (isEmailConfigured() && !(await isDemoOrganization(organizationId))) { // démo : lien affiché seulement, pas d'e-mail réel
    try { await sendMail(invitationMail({ to: user.email, firstName: user.firstName, organizationName: org.name, establishments: memberships.map((m) => m.establishment.name), inviterName, url, expiresDays: INVITE_DAYS })); emailSent = true; } catch { emailSent = false; }
  }
  return { inviteUrl: url, emailSent };
}

/** Crée un compte inactif tant que l'invitation n'est pas acceptée, puis envoie l'e-mail. */
export async function inviteUser(organizationId: string, actor: { id: string; name: string }, input: InviteInput) {
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw new ApiError(409, "EMAIL_TAKEN", "Cet email est déjà utilisé");
  const ests = await prisma.establishment.findMany({ where: { organizationId, id: { in: input.memberships.map((m) => m.establishmentId) } }, select: { id: true } });
  const roles = await prisma.role.findMany({ where: { organizationId, id: { in: input.memberships.map((m) => m.roleId) } }, select: { id: true, key: true } });
  if (ests.length !== new Set(input.memberships.map((m) => m.establishmentId)).size || roles.length !== new Set(input.memberships.map((m) => m.roleId)).size) throw new ApiError(400, "BAD_MEMBERSHIP", "Établissement ou rôle invalide");
  if (roles.some((r) => r.key === "owner")) throw new ApiError(400, "BAD_ROLE", "Le rôle propriétaire ne peut pas être attribué par invitation");
  const token = randomToken(24);
  const user = await prisma.user.create({
    data: {
      organizationId, email, firstName: input.firstName, lastName: input.lastName, color: input.color ?? null,
      passwordHash: await hashPassword(randomToken(24)), // inutilisable tant que l'invitation n'est pas acceptée
      inviteToken: token, inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000), invitedAt: new Date(),
      memberships: { create: input.memberships },
    },
  });
  const delivery = await deliver(user, organizationId, actor.name);
  await audit({ organizationId, userId: actor.id, action: "user.invite", entityType: "user", entityId: user.id, newValue: { email, memberships: input.memberships, emailSent: delivery.emailSent } });
  return { id: user.id, email: user.email, ...delivery };
}

/** Renvoie l'invitation avec un nouveau jeton et une nouvelle date d'expiration. */
export async function resendInvite(organizationId: string, actor: { id: string; name: string }, userId: string) {
  const existing = await prisma.user.findFirst({ where: { id: userId, organizationId }, select: { id: true, inviteToken: true } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Utilisateur introuvable");
  if (!existing.inviteToken) throw new ApiError(400, "NOT_INVITED", "Cet utilisateur a déjà activé son compte");
  const user = await prisma.user.update({ where: { id: userId }, data: { inviteToken: randomToken(24), inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000), invitedAt: new Date() } });
  const delivery = await deliver(user, organizationId, actor.name);
  await audit({ organizationId, userId: actor.id, action: "user.invite_resend", entityType: "user", entityId: user.id, newValue: { emailSent: delivery.emailSent } });
  return { id: user.id, email: user.email, ...delivery };
}

/** Détail public d'une invitation (sans données sensibles), pour la page d'acceptation. */
export async function getInvitation(token: string) {
  if (!token) throw new ApiError(404, "NOT_FOUND", "Invitation introuvable");
  const user = await prisma.user.findUnique({ where: { inviteToken: token }, select: { firstName: true, lastName: true, email: true, inviteExpiresAt: true, isActive: true, organization: { select: { name: true } }, memberships: { select: { role: { select: { name: true } }, establishment: { select: { name: true } } } } } });
  if (!user || !user.isActive) throw new ApiError(404, "NOT_FOUND", "Invitation introuvable ou déjà utilisée");
  const expired = !!user.inviteExpiresAt && user.inviteExpiresAt.getTime() < Date.now();
  return { firstName: user.firstName, lastName: user.lastName, email: user.email, organizationName: user.organization.name, memberships: user.memberships.map((m) => ({ establishment: m.establishment.name, role: m.role.name })), expired, expiresAt: user.inviteExpiresAt };
}

/** Accepte l'invitation : mot de passe (et PIN) choisis, jeton consommé. Retourne l'utilisateur et son premier établissement. */
export async function acceptInvitation(token: string, input: { password: string; pin?: string | null }) {
  if (!token) throw new ApiError(404, "NOT_FOUND", "Invitation introuvable");
  const user = await prisma.user.findUnique({ where: { inviteToken: token }, include: { memberships: { select: { establishmentId: true } } } });
  if (!user || !user.isActive) throw new ApiError(404, "NOT_FOUND", "Invitation introuvable ou déjà utilisée");
  if (user.inviteExpiresAt && user.inviteExpiresAt.getTime() < Date.now()) throw new ApiError(410, "INVITE_EXPIRED", "Cette invitation a expiré : demandez à votre manager de la renvoyer");
  if (input.pin) await assertPinAvailable(input.pin, { establishmentIds: user.memberships.map((m) => m.establishmentId), userId: user.id, guardKey: user.id });
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(input.password), ...(input.pin ? { pinHash: await hashPin(input.pin) } : {}), inviteToken: null, inviteExpiresAt: null, lastLoginAt: new Date() },
  });
  await audit({ organizationId: user.organizationId, userId: user.id, action: "user.invite_accept", entityType: "user", entityId: user.id });
  return { user: updated, establishmentId: user.memberships[0]?.establishmentId ?? null };
}
