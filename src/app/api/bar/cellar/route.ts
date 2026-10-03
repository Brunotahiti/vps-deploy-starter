import { route, ok, created, parseBody } from "@/server/http";
import { requireBar } from "@/server/bar-auth";
import { actorFrom } from "@/server/auth/authorize";
import { bottleSchema } from "@/server/schemas";
import { listCellar, upsertBottle } from "@/server/services/bar";

/** Cave du bar : bouteilles, stock en bouteilles et cl, seuils. */
export const GET = route(async () => {
  const ctx = await requireBar("use");
  return ok(await listCellar(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requireBar("manage");
  return created(await upsertBottle(actorFrom(ctx), await parseBody(req, bottleSchema)));
});
