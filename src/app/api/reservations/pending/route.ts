import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { pendingReservations } from "@/server/services/reservations";

/** Demandes de réservation à valider : affichées en grand à l'équipe (caisse et gestion). */
export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  return ok(await pendingReservations(ctx.establishment.id));
});
