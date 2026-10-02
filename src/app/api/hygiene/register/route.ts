import { route, parseQuery } from "@/server/http";
import { requireHygiene } from "@/server/hygiene-auth";
import { hygieneRangeQuery } from "@/server/schemas";
import { degrees, hygieneRegister } from "@/server/services/hygiene";
import { addDays, formatDate, formatDateTime, localDay } from "@/lib/dates";
import { escapeHtml as esc, printableHtml } from "@/server/html";

const FREQ: Record<string, string> = { DAILY: "Chaque jour", WEEKLY: "Chaque semaine", MONTHLY: "Chaque mois" };
const fmt = (n: number | null) => (n === null ? "—" : degrees(n));

/** Registre d'hygiène imprimable (ou à enregistrer en PDF) pour un contrôle sanitaire : 30 derniers jours par défaut. */
export const GET = route(async (req) => {
  const ctx = await requireHygiene("manage");
  const tz = ctx.establishment.timezone;
  const q = parseQuery(req, hygieneRangeQuery);
  const to = q.to ?? localDay(new Date(), tz);
  const from = q.from ?? addDays(to, -29);
  const r = await hygieneRegister(ctx.establishment.id, from, to);
  const e = ctx.establishment;
  const dt = (iso: string) => esc(formatDateTime(iso, tz));
  const empty = (cols: number, text: string) => `<tr><td colspan="${cols}" class="m">${text}</td></tr>`;
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Registre d'hygiène — ${esc(e.name)}</title>
<style>@page{size:A4;margin:12mm}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;color:#111;margin:0;padding:16px}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px;border-bottom:2px solid #0ea5a4;padding-bottom:3px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:3px 5px;text-align:left;vertical-align:top}th{background:#f1f5f9}.n{white-space:nowrap}.ko{color:#b91c1c;font-weight:700}.m{color:#666;font-style:italic}.head{display:flex;justify-content:space-between;gap:12px;align-items:flex-end}.btn{padding:10px 16px;background:#0ea5a4;color:#fff;border:0;border-radius:8px;font-size:13px}@media print{.btn{display:none}body{padding:0}}</style></head><body>
<div class="head"><div><h1>Registre d'hygiène</h1><div>${esc(e.legalName || e.name)}${e.addressLine1 ? ` · ${esc(e.addressLine1)}` : ""}${e.city ? `, ${esc(e.city)}` : ""}${e.tahitiNumber ? ` · N° Tahiti ${esc(e.tahitiNumber)}` : ""}</div>
<div>Période du ${esc(formatDate(`${from}T12:00:00Z`, "UTC"))} au ${esc(formatDate(`${to}T12:00:00Z`, "UTC"))}</div></div><button class="btn" onclick="window.print()">Imprimer / PDF</button></div>

<h2>Non-conformités et actions correctives (${r.nonConformities.length})</h2>
<table><tr><th>Date</th><th>Constat</th><th>Action corrective</th><th>Par</th></tr>
${r.nonConformities.map((n) => `<tr><td class="n">${dt(n.at)}</td><td class="ko">${esc(n.what)}</td><td>${esc(n.action)}</td><td>${esc(n.by ?? "")}</td></tr>`).join("") || empty(4, "Aucune non-conformité sur la période")}</table>

<h2>Relevés de température (${r.readings.length})</h2>
<table><tr><th>Date</th><th>Équipement</th><th>Relevé</th><th>Limites</th><th>Conforme</th><th>Action corrective</th><th>Par</th></tr>
${r.readings.map((x) => `<tr><td class="n">${dt(x.takenAt)}</td><td>${esc(x.equipment)}</td><td class="n${x.compliant ? "" : " ko"}">${fmt(x.value)}</td><td class="n">${fmt(x.min)} à ${fmt(x.max)}</td><td>${x.compliant ? "Oui" : '<span class="ko">Non</span>'}</td><td>${esc(x.correctiveAction ?? "")}</td><td>${esc(x.by ?? "")}</td></tr>`).join("") || empty(7, "Aucun relevé sur la période")}</table>

<h2>Nettoyage (${r.cleaning.length})</h2>
<table><tr><th>Date</th><th>Tâche</th><th>Zone</th><th>Fréquence</th><th>Par</th><th>Remarque</th></tr>
${r.cleaning.map((c) => `<tr><td class="n">${dt(c.doneAt)}</td><td>${esc(c.task)}</td><td>${esc(c.area ?? "")}</td><td>${esc(FREQ[c.frequency] ?? c.frequency)}</td><td>${esc(c.by ?? "")}</td><td>${esc(c.note ?? "")}</td></tr>`).join("") || empty(6, "Aucun nettoyage enregistré sur la période")}</table>

<h2>Traçabilité : réceptions et préparations (${r.trace.length})</h2>
<table><tr><th>Date</th><th>Type</th><th>Produit</th><th>Fournisseur</th><th>Lot</th><th>Qté</th><th>T° réception</th><th>DLC</th><th>Conforme</th><th>Devenir</th><th>Par</th></tr>
${r.trace.map((t) => `<tr><td class="n">${dt(t.madeAt)}</td><td>${t.kind === "RECEPTION" ? "Réception" : "Préparation"}</td><td>${esc(t.name)}</td><td>${esc(t.supplierName ?? "")}</td><td>${esc(t.lotNumber ?? "")}</td><td>${esc(t.quantity ?? "")}</td><td>${t.temperature === null ? "" : fmt(t.temperature)}</td><td>${t.useBy ? esc(formatDate(t.useBy, tz)) : ""}</td><td>${t.compliant ? "Oui" : `<span class="ko">Non</span> ${esc(t.issue ?? "")}`}</td><td>${t.closedReason === "DISCARDED" ? "Jeté / refusé" : t.closedReason === "USED" ? "Utilisé" : "En cours"}</td><td>${esc(t.by ?? "")}</td></tr>`).join("") || empty(11, "Aucun enregistrement sur la période")}</table>
<p class="m" style="margin-top:16px">Registre tenu avec ManaResto · édité le ${esc(formatDateTime(new Date(), tz))}</p>
</body></html>`;
  return printableHtml(html);
});
