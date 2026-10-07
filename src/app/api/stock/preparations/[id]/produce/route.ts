import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { produceSchema } from "@/server/schemas";
import { producePreparation } from "@/server/services/stock";

/** Produire des lots : les composants sortent du stock, la préparation y entre à son coût réel. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("stock.manage");
  return ok(await producePreparation(actorFrom(ctx), params.id, await parseBody(req, produceSchema)));
});
