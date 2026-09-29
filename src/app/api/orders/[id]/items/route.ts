import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { addItemSchema } from "@/server/schemas";
import { addItem } from "@/server/services/orders";
import { withIdempotency } from "@/server/idempotency";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, addItemSchema);
  return withIdempotency(req, ctx.establishment.id, async () => ok(await addItem(actorFrom(ctx), params.id, body)));
});
