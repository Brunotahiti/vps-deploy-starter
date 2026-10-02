import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { reservationSchema } from "@/server/schemas";
import { simpleReservation, upsertReservation } from "@/server/services/reservations";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  return ok(await upsertReservation(actorFrom(ctx), { id: params.id, ...simpleReservation(ctx, await parseBody(req, reservationSchema)) }));
});
