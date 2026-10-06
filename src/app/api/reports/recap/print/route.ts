import { z } from "zod";
import { route, parseQuery } from "@/server/http";
import { printableHtml } from "@/server/html";
import { daySchema } from "@/server/schemas";
import { getServiceRecap, renderRecapHtml } from "@/server/services/recap";
import { localDay } from "@/lib/dates";
import { recapAccess } from "../route";

/** Version imprimable (A4 / PDF) du récapitulatif de fin de service. */
export const GET = route(async (req) => {
  const { ctx, withMargin, withStaff } = await recapAccess();
  const { day } = parseQuery(req, z.object({ day: daySchema.optional() }));
  const recap = await getServiceRecap(ctx.establishment.id, day ?? localDay(new Date(), ctx.establishment.timezone), { withMargin, withStaff });
  return printableHtml(renderRecapHtml(recap));
});
