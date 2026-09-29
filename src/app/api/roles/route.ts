import { route, parseBody, ok, created } from "@/server/http";
import { requireAuth, requirePermission } from "@/server/auth/context";
import { roleSchema } from "@/server/schemas";
import { createRole, listRoles } from "@/server/services/roles";
import type { PermissionKey } from "@/lib/permissions";

export const GET = route(async () => {
  const ctx = await requireAuth();
  return ok(await listRoles(ctx.organizationId));
});

export const POST = route(async (req) => {
  const ctx = await requirePermission("users.manage");
  const body = await parseBody(req, roleSchema);
  return created(await createRole(ctx.organizationId, { name: body.name, permissions: body.permissions as PermissionKey[] }));
});
