import { route, parseBody, ok } from "@/server/http";
import { requireAuth, requirePermission } from "@/server/auth/context";
import { userUpdateSchema } from "@/server/schemas";
import { updateUser } from "@/server/services/users";
import { setUserPin } from "@/server/services/auth";
import { ApiError } from "@/server/errors";
import { prisma } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";
import { assertCanAssign, assertCanManageUser, assertEmailAllowed } from "@/server/auth/guards";

/** Ferme les autres sessions de l'utilisateur après un changement d'identifiants (mot de passe, PIN, e-mail). */
async function closeOtherSessions(userId: string, keepSessionId: string) {
  await prisma.session.deleteMany({ where: { userId, id: { not: keepSessionId }, impersonatorId: null } });
}

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireAuth();
  const body = await parseBody(req, userUpdateSchema);
  const self = ctx.user.id === params.id;
  const { currentPassword, ...changes } = body;
  if (self && Object.keys(changes).every((k) => ["pin", "password", "displayName", "color", "firstName", "lastName"].includes(k))) {
    // Un utilisateur peut modifier son propre profil et son PIN ; le mot de passe exige l'ancien
    if (changes.password && !(currentPassword && (await verifyPassword(currentPassword, ctx.user.passwordHash)))) throw new ApiError(400, "BAD_CURRENT_PASSWORD", "Mot de passe actuel incorrect");
    if (changes.pin) await setUserPin(ctx.user.id, changes.pin);
    const { pin: _pin, memberships: _m, isActive: _a, email: _e, ...rest } = changes;
    const u = await updateUser(ctx.organizationId, ctx.user.id, ctx.user.id, rest);
    if (changes.password || changes.pin) await closeOtherSessions(ctx.user.id, ctx.sessionId);
    return ok({ id: u.id });
  }
  const mgr = await requirePermission("users.manage");
  if (!mgr) throw new ApiError(403, "FORBIDDEN", "Accès refusé");
  await assertCanManageUser(mgr, params.id);
  if (changes.memberships) await assertCanAssign(mgr, changes.memberships);
  if (changes.email) assertEmailAllowed(changes.email, (await prisma.user.findUnique({ where: { id: params.id }, select: { email: true } }))?.email);
  if (self && changes.password && !(currentPassword && (await verifyPassword(currentPassword, ctx.user.passwordHash)))) throw new ApiError(400, "BAD_CURRENT_PASSWORD", "Mot de passe actuel incorrect");
  const u = await updateUser(ctx.organizationId, ctx.user.id, params.id, changes);
  if (changes.password || changes.pin || changes.email || changes.isActive === false) await closeOtherSessions(params.id, self ? ctx.sessionId : "00000000-0000-0000-0000-000000000000");
  return ok({ id: u.id, email: u.email, isActive: u.isActive });
});
