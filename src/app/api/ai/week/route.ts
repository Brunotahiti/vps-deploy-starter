import { route, ok, created } from "@/server/http";
import { requireOption, requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { rateLimit } from "@/server/rate-limit";
import { weekAdvice } from "@/server/services/ai-assistant";
import { listAiReports } from "@/server/services/quality";

/** Conseils de la semaine rédigés par l'IA à partir des prévisions */
export const GET = route(async () => {
  const ctx = await requirePermission("reports.view");
  requireOption(ctx, "ai");
  return ok((await listAiReports(ctx.establishment.id, "week", 1))[0] ?? null);
});
export const POST = route(async () => {
  const ctx = await requirePermission("reports.view");
  requireOption(ctx, "ai");
  await rateLimit(`ai-week:${ctx.user.id}`, 10, 3600_000);
  return created(await weekAdvice(actorFrom(ctx), ctx.establishment.timezone));
});
