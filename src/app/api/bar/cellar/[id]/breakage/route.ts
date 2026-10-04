import { route, ok, parseBody } from "@/server/http";
import { requireBar } from "@/server/bar-auth";
import { actorFrom } from "@/server/auth/authorize";
import { bottleBreakageSchema } from "@/server/schemas";
import { recordBreakage } from "@/server/services/bar";

/** Casse ou perte au bar (motif obligatoire). */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireBar("use");
  return ok(await recordBreakage(actorFrom(ctx), params.id, await parseBody(req, bottleBreakageSchema)));
});
