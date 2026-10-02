import { route, parseBody, ok, created } from "@/server/http";
import { requireAuth, requirePermission } from "@/server/auth/context";
import { roleSchema } from "@/server/schemas";
import { createRole, listRoles } from "@/server/services/roles";
import type { PermissionKey } from "@/lib/permissions";
import { assertCanGrant } from "@/server/auth/guards";
import { assertNotDemoAccount } from "@/server/services/demo";

export const GET = route(async () => {
  const ctx = await requireAuth();
  return ok(await listRoles(ctx.organizationId));
});

export const POST = route(async (req) => {
  const ctx = await requirePermission("users.manage");
  await assertNotDemoAccount(ctx.organizationId);
  const body = await parseBody(req, roleSchema);
  assertCanGrant(ctx, body.permissions);
  return created(await createRole(ctx.organizationId, { name: body.name, permissions: body.permissions as PermissionKey[] }));
});
