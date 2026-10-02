import { route, ok, parseBody } from "@/server/http";
import { requireOption, requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { reservationSettingsSchema } from "@/server/schemas";
import { reservationSettings, updateReservationSettings } from "@/server/services/reservations";
import type { ReservationSettings } from "@/lib/reservations";

export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  return ok(await reservationSettings(ctx.establishment.id));
});
export const PUT = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  requireOption(ctx, "digital");
  return ok(await updateReservationSettings(actorFrom(ctx), (await parseBody(req, reservationSettingsSchema)) as Partial<ReservationSettings>));
});
