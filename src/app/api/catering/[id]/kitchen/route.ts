import { route } from "@/server/http";
import { requireCatering } from "@/server/catering-auth";
import { getEvent } from "@/server/services/catering";
import { EVENT_KINDS } from "@/lib/catering";
import { formatDate, formatTime } from "@/lib/dates";
import { escapeHtml as esc, printableHtml } from "@/server/html";

/** Fiche cuisine imprimable : quoi préparer, pour combien, à quelle heure ; sans les prix. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requireCatering("view");
  const e = await getEvent(ctx.establishment.id, params.id);
  const tz = ctx.establishment.timezone;
  const qty = (n: number) => String(n).replace(".", ",");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fiche cuisine — ${esc(e.title)}</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;padding:24px;color:#0f172a}h1{margin:0;font-size:24px}.m{margin-top:6px;font-size:15px;color:#334155}.g{display:inline-block;margin-top:10px;padding:6px 12px;border:2px solid #0f172a;border-radius:10px;font-size:20px;font-weight:800}table{width:100%;border-collapse:collapse;margin-top:18px;font-size:16px}td{padding:9px 6px;border-bottom:1px solid #cbd5e1;vertical-align:top}td.q{width:70px;font-weight:800;text-align:right}.n{margin-top:18px;padding:12px 14px;border:2px dashed #dc2626;border-radius:10px;white-space:pre-wrap;font-size:15px}.n b{color:#dc2626}.btn{margin-top:20px;padding:12px 18px;background:#0ea5a4;color:#fff;border:0;border-radius:10px;font-size:15px}@media print{.btn{display:none}body{padding:0}}</style></head><body>
<h1>${esc(e.title)}</h1>
<div class="m">${esc(EVENT_KINDS[e.kind] ?? e.kind)} · ${esc(formatDate(e.startsAt, tz))}, ${esc(formatTime(e.startsAt, tz))} – ${esc(formatTime(e.endsAt, tz))} · ${esc(e.location ?? "au restaurant")}</div>
<div class="g">${e.guests} personne${e.guests > 1 ? "s" : ""}</div>
<table>${e.lines.map((l) => `<tr><td class="q">${esc(qty(l.quantity))} ×</td><td>${esc(l.label)}</td></tr>`).join("")}</table>
${e.kitchenNotes ? `<div class="n"><b>À savoir en cuisine</b>\n${esc(e.kitchenNotes)}</div>` : ""}
<button class="btn" onclick="window.print()">Imprimer la fiche</button></body></html>`;
  return printableHtml(html);
});
