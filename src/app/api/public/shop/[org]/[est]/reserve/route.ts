import { route, ok, parseBody } from "@/server/http";
import { publicReservationSchema } from "@/server/schemas";
import { resolveEstablishment } from "@/server/services/public";
import { createPublicReservation } from "@/server/services/reservations";

export const POST = route<{ org: string; est: string }>(async (req, { params }) => {
  const est = await resolveEstablishment(params.org, params.est);
  const body = await parseBody(req, publicReservationSchema);
  const r = await createPublicReservation(est.id, est.organizationId, { ...body, email: body.email || null });
  return ok({ id: r.id, status: r.status, startsAt: r.startsAt, partySize: r.partySize, name: r.name });
});
