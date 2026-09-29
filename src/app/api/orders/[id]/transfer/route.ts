import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { transferSchema } from "@/server/schemas";
import { transferTable } from "@/server/services/orders";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use", "pos.transfer_table");
  const { tableId } = await parseBody(req, transferSchema);
  return ok(await transferTable(actorFrom(ctx), params.id, tableId));
});
