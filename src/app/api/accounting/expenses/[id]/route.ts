import { route, ok, parseBody } from "@/server/http";
import { requireOption, requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { expenseSchema } from "@/server/schemas";
import { deleteExpense, upsertExpense } from "@/server/services/accounting";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("reports.view");
  requireOption(ctx, "stats");
  return ok(await upsertExpense(actorFrom(ctx), { id: params.id, ...(await parseBody(req, expenseSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("reports.view");
  requireOption(ctx, "stats");
  await deleteExpense(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
