import { route } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { ApiError } from "@/server/errors";
import { prisma } from "@/server/db";
import { contentDisposition } from "@/server/http";

/** Image PNG du QR code d'une table (à imprimer sur les chevalets). */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("floor.manage");
  const table = await prisma.table.findFirst({ where: { id: params.id, establishmentId: ctx.establishment.id } });
  if (!table) throw new ApiError(404, "NOT_FOUND", "Table introuvable");
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || req.nextUrl.origin;
  const QRCode = (await import("qrcode")).default;
  const png = await QRCode.toBuffer(`${base}/m/${table.qrToken}`, { type: "png", width: Math.min(2048, Math.max(64, Number(req.nextUrl.searchParams.get("size")) || 512)), margin: 1, color: { dark: "#0f172a", light: "#ffffff" } });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600", "Content-Disposition": contentDisposition("inline", `qr-table-${table.name}.png`) } });
});
