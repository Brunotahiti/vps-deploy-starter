import { z } from "zod";
import { route, parseBody, ok } from "@/server/http";
import { requireEstablishment } from "@/server/auth/context";
import { authorizeWithManagerPin } from "@/server/services/auth";
import { pin } from "@/server/schemas";
import { ALL_PERMISSIONS, type PermissionKey } from "@/lib/permissions";

/** Vérifie un PIN manager pour une permission donnée (sans exécuter d'opération). */
export const POST = route(async (req) => {
  const ctx = await requireEstablishment();
  const body = await parseBody(req, z.object({ pin, permission: z.enum(ALL_PERMISSIONS as [PermissionKey, ...PermissionKey[]]) }));
  const manager = await authorizeWithManagerPin(ctx.establishment.id, body.pin, body.permission);
  return ok({ authorizedBy: { id: manager.id, name: manager.displayName || `${manager.firstName} ${manager.lastName}` } });
});
