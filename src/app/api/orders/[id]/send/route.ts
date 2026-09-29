import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { sendSchema } from "@/server/schemas";
import { sendCourse } from "@/server/services/orders";
import { withIdempotency } from "@/server/idempotency";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, sendSchema);
  return withIdempotency(req, ctx.establishment.id, async () => ok(await sendCourse(actorFrom(ctx), params.id, body)));
});
