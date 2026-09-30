import { NextResponse } from "next/server";
import { route } from "@/server/http";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";

export const dynamic = "force-dynamic";
/** Sert une photo envoyée (publique : les menus QR et le site du restaurant l'affichent), cache long car l'URL est immuable. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  if (!/^[0-9a-f-]{36}$/.test(params.id)) throw new ApiError(404, "NOT_FOUND", "Photo introuvable");
  const up = await prisma.upload.findUnique({ where: { id: params.id }, select: { mime: true, data: true, size: true } });
  if (!up) throw new ApiError(404, "NOT_FOUND", "Photo introuvable");
  return new NextResponse(new Uint8Array(up.data), { headers: { "Content-Type": up.mime, "Content-Length": String(up.size), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
});
