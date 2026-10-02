import { NextResponse } from "next/server";
import { route } from "@/server/http";
import { clientIp, rateLimitIp } from "@/server/rate-limit";
import { recordSiteHit } from "@/server/services/site-traffic";

export const dynamic = "force-dynamic";

/**
 * Balise de fréquentation du site vitrine (relayée par nginx depuis www.manaresto.com/api/t, même origine).
 * Corps JSON envoyé en text/plain par navigator.sendBeacon : { type: "view" | "click", name?, path, referrer?, utmSource?, utmCampaign? }.
 */
export const POST = route(async (req) => {
  await rateLimitIp(req, "site-visit", 120, 10 * 60_000);
  const text = (await req.text()).slice(0, 2000);
  let body: Record<string, unknown> = {};
  try { const parsed = JSON.parse(text); if (parsed && typeof parsed === "object") body = parsed; } catch { /* balise illisible : ignorée */ }
  await recordSiteHit(body, { ip: clientIp(req), ua: req.headers.get("user-agent") });
  return new NextResponse(null, { status: 204 });
});
