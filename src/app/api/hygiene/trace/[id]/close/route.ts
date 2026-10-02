import { route, ok, parseBody } from "@/server/http";
import { requireHygiene } from "@/server/hygiene-auth";
import { actorFrom } from "@/server/auth/authorize";
import { traceCloseSchema } from "@/server/schemas";
import { closeTrace } from "@/server/services/hygiene";

/** Produit utilisé jusqu'au bout ou jeté : il sort de la liste des dates limites à surveiller. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireHygiene("record");
  return ok(await closeTrace(actorFrom(ctx), params.id, (await parseBody(req, traceCloseSchema)).reason));
});
