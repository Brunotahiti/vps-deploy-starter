import { route, ok, created } from "@/server/http";
import { requireOption, requirePermission } from "@/server/auth/context";
import { actorFrom } from "@/server/auth/authorize";
import { rateLimit } from "@/server/rate-limit";
import { isAiConfigured } from "@/server/ai/claude";
import { createQualityReport, listAiReports, qualityIndicators } from "@/server/services/quality";

/** Analyse qualité inspirée de l'ISO 9001 : chiffres du moment et analyses déjà rédigées */
export const GET = route(async () => {
  const ctx = await requirePermission("reports.view");
  requireOption(ctx, "ai");
  const [indicators, reports] = await Promise.all([qualityIndicators(ctx.establishment.id, ctx.establishment.timezone), listAiReports(ctx.establishment.id, "quality")]);
  return ok({ configured: isAiConfigured(), indicators, reports });
});
export const POST = route(async () => {
  const ctx = await requirePermission("reports.view");
  requireOption(ctx, "ai");
  await rateLimit(`ai-quality:${ctx.user.id}`, 5, 3600_000);
  return created(await createQualityReport(actorFrom(ctx), ctx.establishment.timezone));
});
