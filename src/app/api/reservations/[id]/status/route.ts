import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { reservationStatusSchema } from "@/server/schemas";
import { setReservationStatus } from "@/server/services/reservations";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, reservationStatusSchema);
  return ok(await setReservationStatus(actorFrom(ctx), params.id, body.status, body.tableId));
});
