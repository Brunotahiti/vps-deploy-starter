import { route, ok } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { listOptions } from "@/server/services/options";

/** Options payantes : actives, demandées ou à débloquer. */
export const GET = route(async () => {
  const ctx = await requirePermission("settings.manage");
  return ok(await listOptions(ctx.organizationId));
});
