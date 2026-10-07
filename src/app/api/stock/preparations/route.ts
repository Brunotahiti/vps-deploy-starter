import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { listPreparations } from "@/server/services/stock";

/** Préparations maison (sauces, marinades, fonds…) avec composition, coût du lot et lots réalisables. */
export const GET = route(async () => {
  const ctx = await requirePermission("stock.view");
  return ok(await listPreparations(ctx.establishment.id));
});
