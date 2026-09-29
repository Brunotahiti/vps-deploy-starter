import { route, ok } from "@/server/http";
import { requireApiKey } from "@/server/api-keys";
import { listIngredients, stockAlerts } from "@/server/services/stock";

export const GET = route(async (req) => {
  const ctx = await requireApiKey(req, "stock:read");
  const [ingredients, alerts] = await Promise.all([listIngredients(ctx.establishmentId), stockAlerts(ctx.establishmentId)]);
  return ok({ ingredients, alerts });
});
