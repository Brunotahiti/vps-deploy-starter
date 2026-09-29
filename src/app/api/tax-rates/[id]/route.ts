import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { taxRateSchema } from "@/server/schemas";
import { deleteTaxRate, upsertTaxRate } from "@/server/services/catalog";

export const PATCH = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("catalog.manage");
  return ok(await upsertTaxRate(actorFrom(ctx), { id: params.id, ...(await parseBody(req, taxRateSchema)) }));
});
export const DELETE = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("catalog.manage");
  await deleteTaxRate(actorFrom(ctx), params.id);
  return ok({ deleted: true });
});
