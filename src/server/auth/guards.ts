import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { hasPermission, type PermissionKey } from "@/lib/permissions";
import { isPlatformAdminEmail } from "./platform";
import type { AuthContext } from "./context";

/*
 * Garde-fous de la gestion des comptes : un utilisateur ne peut jamais obtenir, ni donner,
 * plus de droits qu'il n'en a lui-même.
 * - Le compte du propriétaire n'est modifiable que par le propriétaire.
 * - Hors propriétaire : on ne gère que les membres de son établissement, avec des rôles
 *   dont toutes les permissions sont déjà les siennes, et seulement pour son établissement.
 * - Les adresses des administrateurs de la plateforme sont réservées.
 */
type Ctx = Pick<AuthContext, "user" | "permissions" | "organizationId"> & { establishment: { id: string } | null };

/** Adresse réservée : aucun compte ne peut la prendre (inscription, création, invitation, changement d'e-mail). */
export function assertEmailAllowed(email: string, currentEmail?: string | null) {
  const e = email.toLowerCase();
  if (currentEmail && currentEmail.toLowerCase() === e) return;
  if (isPlatformAdminEmail(e)) throw new ApiError(403, "EMAIL_RESERVED", "Cette adresse e-mail est réservée");
}

/** Chaque permission accordée doit déjà appartenir à l'utilisateur qui l'accorde. */
export function assertCanGrant(ctx: Pick<Ctx, "permissions" | "user">, permissions: string[]) {
  if (ctx.user.isOwner) return;
  const missing = permissions.filter((p) => !hasPermission(ctx.permissions, p as PermissionKey));
  if (missing.length) throw new ApiError(403, "FORBIDDEN", `Vous ne pouvez pas accorder des droits que vous n'avez pas : ${missing.join(", ")}`);
}

/** Affectations (établissement + rôle) : hors propriétaire, uniquement l'établissement courant et des rôles « inférieurs ou égaux ». */
export async function assertCanAssign(ctx: Ctx, memberships: { establishmentId: string; roleId: string }[]) {
  if (ctx.user.isOwner) return;
  for (const m of memberships) {
    if (!ctx.establishment || m.establishmentId !== ctx.establishment.id) throw new ApiError(403, "FORBIDDEN", "Vous ne pouvez affecter des membres qu'à votre établissement");
  }
  const roles = await prisma.role.findMany({ where: { organizationId: ctx.organizationId, id: { in: memberships.map((m) => m.roleId) } }, include: { permissions: true } });
  for (const r of roles) assertCanGrant(ctx, r.permissions.map((p) => p.permissionKey));
}

/** Utilisateur cible : le propriétaire n'est géré que par lui-même ; hors propriétaire, membre de l'établissement courant et pas plus puissant. */
export async function assertCanManageUser(ctx: Ctx, targetId: string) {
  if (targetId === ctx.user.id) return;
  const target = await prisma.user.findFirst({ where: { id: targetId, organizationId: ctx.organizationId }, include: { memberships: { include: { role: { include: { permissions: true } } } } } });
  if (!target) throw new ApiError(404, "NOT_FOUND", "Utilisateur introuvable");
  if (target.isOwner) throw new ApiError(403, "OWNER", "Seul le propriétaire peut modifier son propre compte");
  if (isPlatformAdminEmail(target.email)) throw new ApiError(403, "FORBIDDEN", "Ce compte est protégé");
  if (ctx.user.isOwner) return;
  if (!ctx.establishment || !target.memberships.some((m) => m.establishmentId === ctx.establishment!.id)) throw new ApiError(403, "FORBIDDEN", "Cet utilisateur n'appartient pas à votre établissement");
  for (const m of target.memberships) assertCanGrant(ctx, m.role.permissions.map((p) => p.permissionKey));
}
