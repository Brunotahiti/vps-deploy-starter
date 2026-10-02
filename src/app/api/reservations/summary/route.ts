import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { reservationSummary } from "@/server/services/reservations";
import { localDay } from "@/lib/dates";

/** Réservations et couverts par jour, pour le bandeau de la semaine */
export const GET = route(async (req) => {
  const ctx = await requirePermission("pos.use");
  const p = req.nextUrl.searchParams;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(p.get("from") ?? "") ? p.get("from")! : localDay(new Date(), ctx.establishment.timezone);
  const days = Math.min(Math.max(Number(p.get("days")) || 7, 1), 31);
  return ok(await reservationSummary(ctx.establishment.id, from, days, ctx.establishment.timezone));
});
