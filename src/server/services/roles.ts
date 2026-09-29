import { prisma, type Tx } from "@/server/db";
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES, type PermissionKey } from "@/lib/permissions";
import { ApiError } from "@/server/errors";

/** Insère/actualise le référentiel des permissions (idempotent). */
export async function ensurePermissions(tx?: Tx) {
  const db = tx ?? prisma;
  for (const key of ALL_PERMISSIONS) {
    const def = PERMISSIONS[key];
    await db.permission.upsert({
      where: { key },
      update: { group: def.group, description: def.description },
      create: { key, group: def.group, description: def.description },
    });
  }
}

/** Crée les rôles système d'une entreprise s'ils n'existent pas. */
export async function ensureSystemRoles(organizationId: string, tx?: Tx) {
  const db = tx ?? prisma;
  await ensurePermissions(db);
  for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
    const perms = def.permissions === "*" ? ALL_PERMISSIONS : def.permissions;
    const existing = await db.role.findUnique({ where: { organizationId_key: { organizationId, key } } });
    if (existing) continue;
    await db.role.create({
      data: {
        organizationId,
        key,
        name: def.name,
        isSystem: true,
        permissions: { create: perms.map((permissionKey) => ({ permissionKey })) },
      },
    });
  }
}

export async function listRoles(organizationId: string) {
  return prisma.role.findMany({
    where: { organizationId },
    include: { permissions: true, _count: { select: { memberships: true } } },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
}

export async function createRole(organizationId: string, input: { name: string; permissions: PermissionKey[] }) {
  const key = `custom-${Date.now().toString(36)}`;
  return prisma.role.create({
    data: { organizationId, key, name: input.name, permissions: { create: input.permissions.map((permissionKey) => ({ permissionKey })) } },
    include: { permissions: true },
  });
}

export async function updateRole(organizationId: string, roleId: string, input: { name?: string; permissions?: PermissionKey[] }) {
  const role = await prisma.role.findFirst({ where: { id: roleId, organizationId } });
  if (!role) throw new ApiError(404, "NOT_FOUND", "Rôle introuvable");
  if (role.key === "owner") throw new ApiError(400, "OWNER_ROLE", "Le rôle Propriétaire n'est pas modifiable");
  return prisma.$transaction(async (tx) => {
    if (input.permissions) {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({ data: input.permissions.map((permissionKey) => ({ roleId, permissionKey })) });
    }
    return tx.role.update({ where: { id: roleId }, data: { name: input.name }, include: { permissions: true } });
  });
}

export async function deleteRole(organizationId: string, roleId: string) {
  const role = await prisma.role.findFirst({ where: { id: roleId, organizationId }, include: { _count: { select: { memberships: true } } } });
  if (!role) throw new ApiError(404, "NOT_FOUND", "Rôle introuvable");
  if (role.isSystem) throw new ApiError(400, "SYSTEM_ROLE", "Un rôle système ne peut pas être supprimé");
  if (role._count.memberships > 0) throw new ApiError(409, "ROLE_IN_USE", "Ce rôle est encore attribué à des utilisateurs");
  await prisma.role.delete({ where: { id: roleId } });
}
