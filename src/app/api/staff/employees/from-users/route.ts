import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { createEmployeesFromUsers } from "@/server/services/staff";

/** Crée une fiche employé pour chaque utilisateur de l'établissement qui n'en a pas. */
export const POST = route(async () => {
  const ctx = await requirePermission("staff.manage");
  return ok(await createEmployeesFromUsers(actorFrom(ctx)));
});
