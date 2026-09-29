import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { reservationSchema } from "@/server/schemas";
import { upsertReservation } from "@/server/services/reservations";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("customers.manage");
  return ok(await upsertReservation(actorFrom(ctx), { id: params.id, ...(await parseBody(req, reservationSchema)) }));
});
