import { route, parseBody, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { inviteSchema } from "@/server/schemas";
import { inviteUser } from "@/server/services/invitations";
import { assertCanAssign, assertEmailAllowed } from "@/server/auth/guards";
import { assertNotDemoAccount } from "@/server/services/demo";

/** Invite un membre de l'équipe par e-mail (compte créé avec ses rôles, lien de création du mot de passe). */
export const POST = route(async (req) => {
  const ctx = await requirePermission("users.manage");
  await assertNotDemoAccount(ctx.organizationId);
  const body = await parseBody(req, inviteSchema);
  assertEmailAllowed(body.email);
  await assertCanAssign(ctx, body.memberships);
  const inviter = ctx.user.displayName || `${ctx.user.firstName} ${ctx.user.lastName}`;
  return created(await inviteUser(ctx.organizationId, { id: ctx.user.id, name: inviter }, body));
});
