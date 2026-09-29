import { route } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { renderReceiptEscPos, renderReceiptHtml, renderReceiptPdf } from "@/server/receipts/receipt";
import { renderReceiptPdfElegant } from "@/server/receipts/pdf-elegant";

/** GET /api/orders/:id/receipt?format=html|pdf|pdf-thermal|escpos&print=1 — pdf = reçu A5 élégant (téléchargement / e-mail) */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const format = req.nextUrl.searchParams.get("format") ?? "html";
  if (format === "pdf" || format === "pdf-thermal") {
    const pdf = format === "pdf" ? await renderReceiptPdfElegant(ctx.establishment.id, params.id) : await renderReceiptPdf(ctx.establishment.id, params.id);
    return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="ticket-${params.id.slice(0, 8)}.pdf"` } });
  }
  if (format === "escpos") {
    const bytes = await renderReceiptEscPos(ctx.establishment.id, params.id);
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/octet-stream" } });
  }
  const html = await renderReceiptHtml(ctx.establishment.id, params.id, { autoPrint: req.nextUrl.searchParams.get("print") === "1" });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});
