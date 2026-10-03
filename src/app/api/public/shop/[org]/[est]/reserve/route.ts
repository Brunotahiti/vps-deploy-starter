import { route, ok, parseBody } from "@/server/http";
import { rateLimit, rateLimitIp } from "@/server/rate-limit";
import { publicReservationSchema } from "@/server/schemas";
import { resolveEstablishment } from "@/server/services/public";
import { createPublicReservation } from "@/server/services/reservations";

export const POST = route<{ org: string; est: string }>(async (req, { params }) => {
  await rateLimitIp(req, "public-reserve", 10);
  await rateLimitIp(req, "public-reserve-hour", 20, 60 * 60_000);
  const est = await resolveEstablishment(params.org, params.est);
  const { website, ...body } = await parseBody(req, publicReservationSchema);
  // Champ piège rempli : réponse normale pour ne pas renseigner le robot, mais rien n'est enregistré
  if (website) return ok({ id: crypto.randomUUID(), status: "PENDING", startsAt: body.startsAt, partySize: body.partySize, name: body.name });
  // Afflux anormal de demandes sur un même restaurant (toutes adresses confondues)
  await rateLimit(`public-reserve-est:${est.id}`, 60, 60 * 60_000);
  const r = await createPublicReservation(est.id, est.organizationId, body);
  return ok({ id: r.id, status: r.status, startsAt: r.startsAt, partySize: r.partySize, name: r.name });
});
