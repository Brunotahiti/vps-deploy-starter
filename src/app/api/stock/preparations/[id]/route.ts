import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { preparationSchema } from "@/server/schemas";
import { getPreparation, setPreparation } from "@/server/services/stock";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("stock.view");
  return ok(await getPreparation(ctx.establishment.id, params.id));
});
/** Composition d'une préparation : composants et quantités pour un lot, quantité obtenue. */
export const PUT = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  return ok(await setPreparation(actorFrom(ctx), params.id, await parseBody(req, preparationSchema)));
});
