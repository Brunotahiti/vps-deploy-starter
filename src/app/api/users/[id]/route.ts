import { route, parseBody, ok } from "@/server/http";
import { requireAuth, requirePermission } from "@/server/auth/context";
import { userUpdateSchema } from "@/server/schemas";
import { updateUser } from "@/server/services/users";
import { setUserPin } from "@/server/services/auth";
import { ApiError } from "@/server/errors";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireAuth();
  const body = await parseBody(req, userUpdateSchema);
  const self = ctx.user.id === params.id;
  if (self && Object.keys(body).every((k) => ["pin", "password", "displayName", "color", "firstName", "lastName"].includes(k))) {
    // Un utilisateur peut modifier son propre profil et son PIN
    if (body.pin) await setUserPin(ctx.user.id, body.pin);
    const { pin: _pin, memberships: _m, isActive: _a, email: _e, ...rest } = body;
    const u = await updateUser(ctx.organizationId, ctx.user.id, ctx.user.id, rest);
    return ok({ id: u.id });
  }
  const mgr = await requirePermission("users.manage");
  if (!mgr) throw new ApiError(403, "FORBIDDEN", "Accès refusé");
  const u = await updateUser(ctx.organizationId, ctx.user.id, params.id, body);
  return ok({ id: u.id, email: u.email, isActive: u.isActive });
});
