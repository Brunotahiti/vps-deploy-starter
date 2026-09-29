import { route, ok, created, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { reservationSchema } from "@/server/schemas";
import { listReservations, upsertReservation } from "@/server/services/reservations";
import { localDay } from "@/lib/dates";

export const GET = route(async (req) => {
  const ctx = await requirePermission("pos.use");
  const day = req.nextUrl.searchParams.get("day") ?? localDay(new Date(), ctx.establishment.timezone);
  return ok(await listReservations(ctx.establishment.id, day, ctx.establishment.timezone));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("customers.manage");
  return created(await upsertReservation(actorFrom(ctx), await parseBody(req, reservationSchema)));
});
