import { route, ok, parseBody } from "@/server/http";
import { requireBar } from "@/server/bar-auth";
import { actorFrom } from "@/server/auth/authorize";
import { bottleReceiveSchema } from "@/server/schemas";
import { receiveBottles } from "@/server/services/bar";

/** Réception de bouteilles. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireBar("manage");
  return ok(await receiveBottles(actorFrom(ctx), params.id, await parseBody(req, bottleReceiveSchema)));
});
