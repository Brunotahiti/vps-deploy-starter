import { route, contentDisposition } from "@/server/http";
import { requireScreens } from "@/server/screens-auth";
import { ApiError } from "@/server/errors";
import { prisma } from "@/server/db";

/** QR code de l'adresse d'un écran : à scanner avec la tablette ou la télévision connectée. */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireScreens();
  const s = await prisma.screen.findFirst({ where: { id: params.id, establishmentId: ctx.establishment.id } });
  if (!s) throw new ApiError(404, "NOT_FOUND", "Écran introuvable");
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || req.nextUrl.origin;
  const QRCode = (await import("qrcode")).default;
  const png = await QRCode.toBuffer(`${base}/ecran/${s.token}`, { type: "png", width: 512, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "Content-Disposition": contentDisposition("inline", `ecran-${s.name}.png`) } });
});
