import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { roleSchema } from "@/server/schemas";
import { deleteRole, updateRole } from "@/server/services/roles";
import type { PermissionKey } from "@/lib/permissions";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("users.manage");
  const body = await parseBody(req, roleSchema.partial());
  return ok(await updateRole(ctx.organizationId, params.id, { name: body.name, permissions: body.permissions as PermissionKey[] | undefined }));
});

export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("users.manage");
  await deleteRole(ctx.organizationId, params.id);
  return ok({ deleted: true });
});
