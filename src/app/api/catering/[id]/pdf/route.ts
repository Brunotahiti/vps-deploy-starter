import { route, contentDisposition } from "@/server/http";
import { requireCatering } from "@/server/catering-auth";
import { renderEventPdf } from "@/server/services/catering";

/** Devis (?doc=quote) ou facture (?doc=invoice) en PDF. */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireCatering("manage");
  const doc = req.nextUrl.searchParams.get("doc") === "invoice" ? "invoice" : "quote";
  const { pdf, filename } = await renderEventPdf(ctx.establishment.id, params.id, doc);
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": contentDisposition(req.nextUrl.searchParams.get("download") ? "attachment" : "inline", filename), "Cache-Control": "private, no-store" } });
});
