import { route, ok, parseBody } from "@/server/http";
import { requireBar } from "@/server/bar-auth";
import { actorFrom } from "@/server/auth/authorize";
import { cocktailSchema } from "@/server/schemas";
import { setCocktail } from "@/server/services/bar";

export const PUT = route<{ productId: string }>(async (req, { params }) => {
  const ctx = await requireBar("manage");
  return ok(await setCocktail(actorFrom(ctx), params.productId, await parseBody(req, cocktailSchema)));
});
