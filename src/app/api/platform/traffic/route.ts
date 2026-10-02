import { route, ok } from "@/server/http";
import { requirePlatformAdmin } from "@/server/auth/platform";
import { trafficStats } from "@/server/services/site-traffic";

/** Fréquentation du site et des connexions sur 7, 30 ou 90 jours. */
export const GET = route(async (req) => {
  await requirePlatformAdmin();
  const days = Number(req.nextUrl.searchParams.get("days"));
  return ok(await trafficStats([7, 30, 90].includes(days) ? days : 30));
});
