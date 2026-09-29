import { route, parseBody, ok, created } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { taxRateSchema } from "@/server/schemas";
import { listTaxRates, upsertTaxRate } from "@/server/services/catalog";

export const GET = route(async () => {
  const ctx = await requirePermission("catalog.view");
  return ok(await listTaxRates(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requirePermission("catalog.manage");
  return created(await upsertTaxRate(actorFrom(ctx), await parseBody(req, taxRateSchema)));
});
