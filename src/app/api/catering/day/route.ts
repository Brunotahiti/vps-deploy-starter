import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { eventsOfDay } from "@/server/services/catering";
import { localDay } from "@/lib/dates";

/** Événements confirmés du jour, pour le bandeau de la page Réservations (option Traiteur ; sinon liste vide). */
export const GET = route(async (req) => {
  const ctx = await requirePermission("pos.use");
  if (!ctx.options.includes("catering")) return ok([]);
  const day = req.nextUrl.searchParams.get("day");
  return ok(await eventsOfDay(ctx.establishment.id, day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : localDay(new Date(), ctx.establishment.timezone), ctx.establishment.timezone));
});
