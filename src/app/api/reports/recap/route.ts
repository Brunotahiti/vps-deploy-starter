import { z } from "zod";
import { route, parseQuery, ok } from "@/server/http";
import { can, requireEstablishment } from "@/server/auth/context";
import { ApiError } from "@/server/errors";
import { daySchema } from "@/server/schemas";
import { getServiceRecap } from "@/server/services/recap";
import { localDay } from "@/lib/dates";

/** Qui peut voir le récapitulatif : les rapports, ou la clôture de caisse (fin de service). La marge exige le droit Rapports. */
export async function recapAccess() {
  const ctx = await requireEstablishment();
  const reports = can(ctx, "reports.view");
  if (!reports && !can(ctx, "cash.close")) throw new ApiError(403, "FORBIDDEN", "Permission requise : reports.view", { permission: "reports.view" });
  return { ctx, withMargin: reports, withStaff: reports && ctx.options.includes("team") && can(ctx, "staff.manage") };
}

/** Récapitulatif de fin de service d'une journée (aujourd'hui par défaut). */
export const GET = route(async (req) => {
  const { ctx, withMargin, withStaff } = await recapAccess();
  const { day } = parseQuery(req, z.object({ day: daySchema.optional() }));
  return ok(await getServiceRecap(ctx.establishment.id, day ?? localDay(new Date(), ctx.establishment.timezone), { withMargin, withStaff }));
});
