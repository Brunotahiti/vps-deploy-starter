import { route, parseBody, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { pinUserCreateSchema } from "@/server/schemas";
import { createPinUser } from "@/server/services/users";
import { assertCanAssign } from "@/server/auth/guards";
import { assertNotDemoAccount } from "@/server/services/demo";

/** Compte employé « PIN seul » : prénom, nom, profil, PIN — sans e-mail ni mot de passe. */
export const POST = route(async (req) => {
  const ctx = await requirePermission("users.manage");
  await assertNotDemoAccount(ctx.organizationId);
  const body = await parseBody(req, pinUserCreateSchema);
  await assertCanAssign(ctx, body.memberships);
  const u = await createPinUser(ctx.organizationId, ctx.user.id, body);
  return created({ id: u.id });
});
