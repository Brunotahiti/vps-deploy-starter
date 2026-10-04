import { route, ok, parseBody } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { actorFrom } from "@/server/auth/authorize";
import { wineReceiveSchema } from "@/server/schemas";
import { receiveWine } from "@/server/services/wine";

/** Réception de bouteilles : stock et coût moyen mis à jour. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireWine("manage");
  return ok(await receiveWine(actorFrom(ctx), params.id, await parseBody(req, wineReceiveSchema)));
});
