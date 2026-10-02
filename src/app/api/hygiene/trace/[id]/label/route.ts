import { route } from "@/server/http";
import { requireHygiene } from "@/server/hygiene-auth";
import { getTrace } from "@/server/services/hygiene";
import { formatDate, formatDateTime } from "@/lib/dates";
import { escapeHtml as esc, printableHtml } from "@/server/html";

/** Étiquette de préparation (ou de produit déconditionné) : nom, fabrication, date limite, lot, auteur. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireHygiene("record");
  const r = await getTrace(ctx.establishment.id, params.id);
  const tz = ctx.establishment.timezone;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquette ${esc(r.name)}</title>
<style>@page{size:60mm 40mm;margin:2mm}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:8px}.l{width:56mm;border:1px solid #000;border-radius:4px;padding:6px 8px;margin:auto}.n{font-weight:800;font-size:15px;line-height:1.15}.d{margin-top:6px;font-size:11px}.dlc{margin-top:4px;font-size:16px;font-weight:800;border-top:1px dashed #000;padding-top:4px}.s{font-size:10px;color:#333;margin-top:3px}.btn{display:block;margin:12px auto;padding:10px 16px;background:#0ea5a4;color:#fff;border:0;border-radius:8px;font-size:14px}@media print{.btn{display:none}body{padding:0}}</style></head><body>
<div class="l"><div class="n">${esc(r.name)}</div>
<div class="d">${r.kind === "PREPARATION" ? "Préparé le" : "Reçu le"} ${esc(formatDateTime(r.madeAt, tz))}</div>
${r.useBy ? `<div class="dlc">À consommer avant le ${esc(formatDate(r.useBy, tz))}</div>` : ""}
<div class="s">${r.lotNumber ? `Lot ${esc(r.lotNumber)} · ` : ""}${r.quantity ? `${esc(r.quantity)} · ` : ""}${esc(r.by ?? "")} · ${esc(ctx.establishment.name)}</div></div>
<button class="btn" onclick="window.print()">Imprimer l'étiquette</button></body></html>`;
  return printableHtml(html);
});
