import { route, contentDisposition } from "@/server/http";
import { requireAccounts } from "@/server/accounts-auth";
import { renderInvoicePdf } from "@/server/services/accounts";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireAccounts("manage");
  const { pdf, number } = await renderInvoicePdf(ctx.establishment.id, params.id);
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": contentDisposition(req.nextUrl.searchParams.get("download") ? "attachment" : "inline", `facture-${number}.pdf`), "Cache-Control": "private, no-store" } });
});
