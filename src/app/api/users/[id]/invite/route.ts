import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { resendInvite } from "@/server/services/invitations";
import { assertCanManageUser } from "@/server/auth/guards";

/** Renvoie l'invitation (nouveau lien, nouvelle expiration). */
export const POST = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("users.manage");
  await assertCanManageUser(ctx, params.id);
  const inviter = ctx.user.displayName || `${ctx.user.firstName} ${ctx.user.lastName}`;
  return ok(await resendInvite(ctx.organizationId, { id: ctx.user.id, name: inviter }, params.id));
});
