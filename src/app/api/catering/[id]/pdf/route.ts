import { route, contentDisposition } from "@/server/http";
import { requireCatering } from "@/server/catering-auth";
import { renderEventInvoiceXml, renderEventPdf } from "@/server/services/catering";

/** Devis (?doc=quote) ou facture (?doc=invoice) en PDF ; la facture est une facture électronique (PDF/A-3 + Factur-X), `?xml=1` renvoie son XML seul. */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireCatering("manage");
  const doc = req.nextUrl.searchParams.get("doc") === "invoice" ? "invoice" : "quote";
  if (doc === "invoice" && req.nextUrl.searchParams.get("xml")) {
    const { xml, number } = await renderEventInvoiceXml(ctx.establishment.id, params.id);
    return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": contentDisposition("attachment", `facture-${number}.factur-x.xml`), "Cache-Control": "private, no-store" } });
  }
  const { pdf, filename } = await renderEventPdf(ctx.establishment.id, params.id, doc);
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": contentDisposition(req.nextUrl.searchParams.get("download") ? "attachment" : "inline", filename), "Cache-Control": "private, no-store" } });
});
