import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { roleSchema } from "@/server/schemas";
import { deleteRole, updateRole } from "@/server/services/roles";
import type { PermissionKey } from "@/lib/permissions";
import { assertCanGrant } from "@/server/auth/guards";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { assertNotDemoAccount } from "@/server/services/demo";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("users.manage");
  await assertNotDemoAccount(ctx.organizationId);
  const body = await parseBody(req, roleSchema.partial());
  if (!ctx.user.isOwner) {
    // Hors propriétaire : pas de modification des rôles système (communs à toute l'entreprise) ni d'un rôle plus puissant que soi
    const role = await prisma.role.findFirst({ where: { id: params.id, organizationId: ctx.organizationId }, include: { permissions: true } });
    if (!role) throw new ApiError(404, "NOT_FOUND", "Rôle introuvable");
    if (role.isSystem) throw new ApiError(403, "SYSTEM_ROLE", "Seul le propriétaire peut modifier un rôle système");
    assertCanGrant(ctx, role.permissions.map((p) => p.permissionKey));
  }
  if (body.permissions) assertCanGrant(ctx, body.permissions);
  return ok(await updateRole(ctx.organizationId, params.id, { name: body.name, permissions: body.permissions as PermissionKey[] | undefined }));
});

export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("users.manage");
  await assertNotDemoAccount(ctx.organizationId);
  if (!ctx.user.isOwner) {
    const role = await prisma.role.findFirst({ where: { id: params.id, organizationId: ctx.organizationId }, include: { permissions: true } });
    if (role) assertCanGrant(ctx, role.permissions.map((p) => p.permissionKey));
  }
  await deleteRole(ctx.organizationId, params.id);
  return ok({ deleted: true });
});
