import { route, parseBody, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { tableStateSchema } from "@/server/schemas";
import { setTableState } from "@/server/services/floor";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const { state } = await parseBody(req, tableStateSchema);
  return ok(await setTableState(actorFrom(ctx), params.id, state));
});
