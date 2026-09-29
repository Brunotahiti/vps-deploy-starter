import { route } from "@/server/http";
import { requireEstablishment, can } from "@/server/auth/context";
import { ApiError } from "@/server/errors";
import { renderKitchenTicketEscPos, renderKitchenTicketHtml } from "@/server/receipts/kitchen-ticket";

/** Bon cuisine : `?format=html` (impression navigateur, `&print=1` lance l'impression) ou `escpos`. */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const ctx = await requireEstablishment();
  if (!can(ctx, "kds.use") && !can(ctx, "pos.use")) throw new ApiError(403, "FORBIDDEN", "Permission requise : kds.use ou pos.use");
  const format = req.nextUrl.searchParams.get("format") ?? "html";
  if (format === "escpos") {
    const bytes = await renderKitchenTicketEscPos(ctx.establishment.id, params.id);
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="cuisine-${params.id}.bin"` } });
  }
  const html = await renderKitchenTicketHtml(ctx.establishment.id, params.id, { autoPrint: req.nextUrl.searchParams.get("print") === "1" });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
});
