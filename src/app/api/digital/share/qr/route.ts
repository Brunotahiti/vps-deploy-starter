import { route, contentDisposition } from "@/server/http";
import { requirePermission, requireOption } from "@/server/auth/context";
import { shareUrl } from "@/lib/share";
import { ensureShareSlug } from "@/server/services/share";

/** QR code de l'adresse de partage du site : flyers, cartes de visite, vitrine, menus. */
export const GET = route(async (req) => {
  const ctx = await requirePermission("settings.manage");
  requireOption(ctx, "digital");
  const slug = ctx.establishment.shareSlug ?? (await ensureShareSlug(ctx.establishment.id));
  const QRCode = (await import("qrcode")).default;
  const png = await QRCode.toBuffer(shareUrl(slug), { type: "png", width: 1024, margin: 2, errorCorrectionLevel: "M", color: { dark: "#0f172a", light: "#ffffff" } });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "Content-Disposition": contentDisposition(req.nextUrl.searchParams.get("download") ? "attachment" : "inline", `qr-${slug}.png`) } });
});
