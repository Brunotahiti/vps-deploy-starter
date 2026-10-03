import { route } from "@/server/http";
import { requireWine } from "@/server/wine-auth";
import { wineListPdf } from "@/server/services/wine";

/** Carte des vins en PDF (A4), à imprimer. */
export const GET = route(async () => {
  const ctx = await requireWine("use");
  const pdf = await wineListPdf(ctx.establishment.id);
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="carte-des-vins.pdf"`, "Cache-Control": "no-store" } });
});
