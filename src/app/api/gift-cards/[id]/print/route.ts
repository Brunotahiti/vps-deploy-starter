import { route } from "@/server/http";
import { requireMarketing } from "@/server/marketing-auth";
import { getGiftCard } from "@/server/services/marketing";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { escapeHtml as esc, printableHtml } from "@/server/html";

/** Carte cadeau imprimable (format carte postale A6) : montant, code, bénéficiaire, message, validité. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireMarketing("sell");
  const c = await getGiftCard(ctx.establishment.id, params.id);
  const e = c.establishment;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Carte cadeau ${esc(c.code)}</title>
<style>@page{size:A6 landscape;margin:0}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f3f5f8}.card{width:148mm;height:105mm;margin:16px auto;box-sizing:border-box;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,#14aaa3,#0f6e6c);color:#fff;padding:14mm 12mm;position:relative}.k{font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.85}.n{font-size:20px;font-weight:800;margin-top:2px}.a{font-size:40px;font-weight:800;margin-top:12mm}.m{margin-top:4mm;font-size:13px;opacity:.95;max-width:110mm}.code{position:absolute;right:12mm;bottom:12mm;background:#fff;color:#0f6e6c;border-radius:10px;padding:6px 12px;font:700 18px ui-monospace,Menlo,monospace;letter-spacing:.08em}.f{position:absolute;left:12mm;bottom:12mm;max-width:80mm;font-size:11px;line-height:1.35;opacity:.9}.btn{display:block;margin:12px auto;padding:10px 16px;background:#0ea5a4;color:#fff;border:0;border-radius:8px;font-size:14px}@media print{.btn{display:none}body{background:#fff}.card{margin:0;border-radius:0}}</style></head><body>
<div class="card"><div class="k">Carte cadeau</div><div class="n">${esc(e.name)}</div>
<div class="a">${esc(formatMoney(c.initialAmount, e.currency))}</div>
${c.recipientName ? `<div class="m">Pour ${esc(c.recipientName)}${c.buyerName ? `, de la part de ${esc(c.buyerName)}` : ""}</div>` : ""}
${c.message ? `<div class="m"><em>« ${esc(c.message)} »</em></div>` : ""}
<div class="f">${c.expiresAt ? `Valable jusqu'au ${esc(formatDate(c.expiresAt, e.timezone))}` : ""}${e.phone ? `${c.expiresAt ? " · " : ""}Réservations ${esc(e.phone)}` : ""}</div>
<div class="code">${esc(c.code)}</div></div>
<button class="btn" onclick="window.print()">Imprimer la carte</button></body></html>`;
  return printableHtml(html);
});
