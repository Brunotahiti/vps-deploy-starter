import { route, ok, created, parseBody, parseQuery } from "@/server/http";
import { requireOption, requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { accountingQuery, expenseSchema } from "@/server/schemas";
import { listExpenses, upsertExpense } from "@/server/services/accounting";
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";

/** Dépenses de l'établissement (loyer, énergie, factures…) : liste sur une période et saisie. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("reports.view");
  requireOption(ctx, "stats");
  const q = parseQuery(req, accountingQuery);
  const tz = ctx.establishment.timezone;
  return ok(await listExpenses(ctx.establishment.id, startOfLocalDay(q.from, tz), endOfLocalDay(q.to, tz)));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("reports.view");
  requireOption(ctx, "stats");
  return created(await upsertExpense(actorFrom(ctx), await parseBody(req, expenseSchema)));
});
