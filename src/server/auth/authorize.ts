import { ApiError } from "@/server/errors";
import { hasPermission, type PermissionKey } from "@/lib/permissions";
import type { AuthContext } from "./context";
import { authorizeWithManagerPin } from "@/server/services/auth";
import type { Actor } from "@/server/services/orders";

export function actorFrom(ctx: AuthContext & { establishment: NonNullable<AuthContext["establishment"]> }): Actor {
  return { organizationId: ctx.organizationId, establishmentId: ctx.establishment.id, userId: ctx.user.id, terminalId: ctx.terminal?.id ?? null };
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
  if (!managerPin) throw new ApiError(403, "PIN_REQUIRED", "Autorisation manager requise", { permission });
  const manager = await authorizeWithManagerPin(ctx.establishment.id, managerPin, permission);
  return { ...actor, authorizedById: manager.id };
}
