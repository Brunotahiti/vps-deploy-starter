import { route, ok, parseQuery } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { periodQuery } from "@/server/schemas";
import { organizationOverview } from "@/server/services/organization";

export const GET = route(async (req) => {
  const ctx = await requirePermission("reports.view_global");
  const q = parseQuery(req, periodQuery);
  return ok(await organizationOverview(ctx.organizationId, q.from, q.to));
});
