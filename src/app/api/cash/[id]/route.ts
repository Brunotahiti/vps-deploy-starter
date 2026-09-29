import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { getSessionReport } from "@/server/services/cash";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("pos.use");
  return ok(await getSessionReport(ctx.establishment.id, params.id));
});
