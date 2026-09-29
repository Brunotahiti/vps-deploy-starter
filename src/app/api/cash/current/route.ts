import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { findOpenSession, getSessionReport } from "@/server/services/cash";

export const GET = route(async () => {
  const ctx = await requirePermission("pos.use");
  const s = await findOpenSession(ctx.establishment.id, ctx.terminal?.id ?? null);
  return ok(s ? await getSessionReport(ctx.establishment.id, s.id) : null);
});
