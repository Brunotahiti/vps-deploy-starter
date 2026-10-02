import { route, ok } from "@/server/http";
import { requireOption, requirePermission } from "@/server/auth/context";
import { forecast } from "@/server/services/forecast";

/** Prévisions de fréquentation (option Assistant IA), calculées sans appel à l'IA */
export const GET = route(async (req) => {
  const ctx = await requirePermission("pos.use");
  requireOption(ctx, "ai");
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 14, 1), 31);
  const from = req.nextUrl.searchParams.get("from");
  return ok(await forecast(ctx.establishment.id, ctx.establishment.timezone, days, from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : undefined));
});
