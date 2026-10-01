import type { NextRequest } from "next/server";
import { findCloudPrinter, handleEpson, handleStarDone, handleStarFetch, handleStarPoll } from "@/server/hardware/cloud-print";

/**
 * Adresse interrogée par les imprimantes connectées (Epson Server Direct Print, Star CloudPRNT).
 * Pas de session : l'imprimante est reconnue par le jeton secret de l'adresse. Réponses volontairement muettes en cas d'erreur.
 */
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };
const notFound = () => new Response("", { status: 404 });

export async function POST(req: NextRequest, { params }: Ctx) {
  const printer = await findCloudPrinter((await params).token);
  if (!printer) return notFound();
  const raw = (await req.text()).slice(0, 256_000);
  if (printer.driver === "cloud-epson") return handleEpson(printer, new URLSearchParams(raw));
  let body: { statusCode?: string; printingInProgress?: boolean } | null = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
  return handleStarPoll(printer, body);
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const printer = await findCloudPrinter((await params).token);
  if (!printer || printer.driver !== "cloud-star") return notFound();
  return handleStarFetch(printer, req.nextUrl.searchParams);
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const printer = await findCloudPrinter((await params).token);
  if (!printer || printer.driver !== "cloud-star") return notFound();
  return handleStarDone(printer, req.nextUrl.searchParams);
}
