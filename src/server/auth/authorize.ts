import { ApiError } from "@/server/errors";
import { hasPermission, type PermissionKey } from "@/lib/permissions";
import type { AuthContext } from "./context";
import { headers } from "next/headers";
import { authorizeWithManagerPin } from "@/server/services/auth";
import { findOfflinePass } from "@/server/services/offline-pass";
import { prisma } from "@/server/db";
import type { Actor } from "@/server/services/orders";

export function actorFrom(ctx: AuthContext & { establishment: NonNullable<AuthContext["establishment"]> }): Actor {
  return { organizationId: ctx.organizationId, establishmentId: ctx.establishment.id, userId: ctx.user.id, terminalId: ctx.terminal?.id ?? null };
}

export const OFFLINE_MANAGER_HEADER = "x-offline-manager";

async function passHasPermission(userId: string, isOwner: boolean, establishmentId: string, permission: PermissionKey) {
  if (isOwner) return true;
  const m = await prisma.userEstablishment.findFirst({ where: { userId, establishmentId }, include: { role: { include: { permissions: true } } } });
  return !!m && hasPermission(m.role.permissions.map((p) => p.permissionKey), permission);
}

/**
 * Opération sensible : l'utilisateur doit détenir la permission, sinon un PIN
 * manager (détenteur de la permission) peut autoriser l'opération ponctuellement.
 */
export async function authorizeSensitive(
  ctx: AuthContext & { establishment: NonNullable<AuthContext["establishment"]> },
  permission: PermissionKey,
  managerPin?: string | null,
): Promise<Actor> {
  const actor = actorFrom(ctx);
  if (hasPermission(ctx.permissions, permission)) return actor;
  // Autorisation donnée hors ligne (PIN manager vérifié sur la tablette) : laissez-passer du manager, sur ce terminal
  const managerPass = !managerPin && ctx.terminal ? (await headers()).get(OFFLINE_MANAGER_HEADER) : null;
  if (managerPass) {
    const pass = await findOfflinePass(managerPass, ctx.terminal!.id);
    if (pass && pass.establishmentId === ctx.establishment.id && (await passHasPermission(pass.userId, pass.user.isOwner, ctx.establishment.id, permission))) return { ...actor, authorizedById: pass.userId };
  }
  if (!managerPin) throw new ApiError(403, "PIN_REQUIRED", "Autorisation manager requise", { permission });
  const manager = await authorizeWithManagerPin(ctx.establishment.id, managerPin, permission);
  return { ...actor, authorizedById: manager.id };
}
