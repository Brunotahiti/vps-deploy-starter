import { route, ok, parseQuery } from "@/server/http";
import { requireOption, requirePermission } from "@/server/auth/context";
import { accountingQuery } from "@/server/schemas";
import { getAccountingSummary } from "@/server/services/accounting";

/** Synthèse comptable de la période : ventes et TVA, encaissements, achats, dépenses, personnel, résultat. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("reports.view");
  requireOption(ctx, "stats");
  const q = parseQuery(req, accountingQuery);
  return ok(await getAccountingSummary(ctx.establishment.id, q.from, q.to, ctx.establishment.timezone, { withStaff: ctx.options.includes("team") }));
});
