import { route, contentDisposition } from "@/server/http";
import { requireAccounts } from "@/server/accounts-auth";
import { renderInvoicePdf, renderInvoiceXml } from "@/server/services/accounts";

/** Facture électronique : PDF/A-3 avec XML Factur-X incorporé ; `?xml=1` renvoie le XML seul (EN 16931). */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireAccounts("manage");
  if (req.nextUrl.searchParams.get("xml")) {
    const { xml, number } = await renderInvoiceXml(ctx.establishment.id, params.id);
    return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Content-Disposition": contentDisposition("attachment", `facture-${number}.factur-x.xml`), "Cache-Control": "private, no-store" } });
  }
  const { pdf, number } = await renderInvoicePdf(ctx.establishment.id, params.id);
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": contentDisposition(req.nextUrl.searchParams.get("download") ? "attachment" : "inline", `facture-${number}.pdf`), "Cache-Control": "private, no-store" } });
});
