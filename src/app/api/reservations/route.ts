import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { simpleReservation } from "@/server/services/reservations";
import { actorFrom } from "@/server/auth/authorize";
import { reservationSchema } from "@/server/schemas";
import { listReservations, upsertReservation } from "@/server/services/reservations";
import { localDay } from "@/lib/dates";

export const GET = route(async (req) => {
  const ctx = await requirePermission("pos.use");
  const day = req.nextUrl.searchParams.get("day") ?? localDay(new Date(), ctx.establishment.timezone);
  return ok(await listReservations(ctx.establishment.id, day, ctx.establishment.timezone));
});
/** Programme de base : toute personne qui tient la caisse peut prendre une réservation au téléphone */
export const POST = route(async (req) => {
  const ctx = await requirePermission("pos.use");
  return created(await upsertReservation(actorFrom(ctx), simpleReservation(ctx, await parseBody(req, reservationSchema))));
});
