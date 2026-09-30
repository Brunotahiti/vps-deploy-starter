import { route, ok, parseBody } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { serviceStepSchema } from "@/server/schemas";
import { setStepStatus } from "@/server/services/service-tracking";

export const POST = route<{ id: string; key: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const body = await parseBody(req, serviceStepSchema);
  return ok(await setStepStatus(actorFrom(ctx), params.id, params.key, body.status, body.reason ?? null));
});
