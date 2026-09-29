import { z } from "zod";
import { route, parseQuery, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { daySchema } from "@/server/schemas";
import { getOrganizationOverview } from "@/server/services/reports";
import { localDay } from "@/lib/dates";

export const GET = route(async (req) => {
  const ctx = await requirePermission("reports.view_global");
  const { day } = parseQuery(req, z.object({ day: daySchema.optional() }));
  return ok(await getOrganizationOverview(ctx.organizationId, day ?? localDay(new Date(), ctx.establishment.timezone)));
});
