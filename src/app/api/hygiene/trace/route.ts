import { route, ok, created, parseBody } from "@/server/http";
import { requireHygiene } from "@/server/hygiene-auth";
import { actorFrom } from "@/server/auth/authorize";
import { traceRecordSchema } from "@/server/schemas";
import { createTrace, listTrace } from "@/server/services/hygiene";

export const GET = route(async () => {
  const ctx = await requireHygiene("record");
  return ok(await listTrace(ctx.establishment.id));
});
export const POST = route(async (req) => {
  const ctx = await requireHygiene("record");
  return created(await createTrace(actorFrom(ctx), await parseBody(req, traceRecordSchema)));
});
