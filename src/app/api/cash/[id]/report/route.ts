import { route } from "@/server/http";
import { requirePermission } from "@/server/auth/context";
import { getSessionReport } from "@/server/services/cash";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { escapeHtml as esc, printableHtml } from "@/server/html";

const METHOD: Record<string, string> = { CASH: "Espèces", CARD: "Carte bancaire", CHECK: "Chèque", TRANSFER: "Virement", MEAL_VOUCHER: "Ticket restaurant", COMPLIMENTARY: "Offert", OTHER: "Autre" };
const KIND: Record<string, string> = { OPENING: "Ouverture", SALE: "Vente", REFUND: "Remboursement", PAY_IN: "Entrée", PAY_OUT: "Sortie", DEPOSIT: "Dépôt", CORRECTION: "Correction", CLOSING: "Clôture" };

/** Rapport de caisse X (session ouverte) / Z (session clôturée), imprimable. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const ctx = await requirePermission("pos.use");
  const { session, summary } = await getSessionReport(ctx.establishment.id, params.id);
  const f = (n: number) => formatMoney(n, ctx.establishment.currency);
  const tz = ctx.establishment.timezone;
  const name = (u: { firstName: string; lastName: string; displayName: string | null } | null) => esc(u ? u.displayName || `${u.firstName} ${u.lastName}` : "—");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport ${session.status === "CLOSED" ? "Z" : "X"}</title>
<style>body{font-family:ui-monospace,Menlo,monospace;font-size:12px;margin:0;padding:12px}.t{width:72mm;margin:auto}table{width:100%;border-collapse:collapse}td{padding:2px 0}.r{text-align:right}.c{text-align:center}hr{border:0;border-top:1px dashed #000;margin:6px 0}.big{font-weight:bold;font-size:14px}.btn{display:block;margin:12px auto;padding:10px 16px;background:#0ea5a4;color:#fff;border:0;border-radius:8px}@media print{.btn{display:none}}</style></head><body><div class="t">
<div class="c big">${esc(ctx.establishment.name)}</div><div class="c">RAPPORT ${session.status === "CLOSED" ? "Z (clôture)" : "X (en cours)"}</div><hr>
<table><tr><td>Ouverture</td><td class="r">${formatDateTime(session.openedAt, tz)}</td></tr><tr><td>Par</td><td class="r">${name(session.openedBy)}</td></tr>${session.closedAt ? `<tr><td>Clôture</td><td class="r">${formatDateTime(session.closedAt, tz)}</td></tr><tr><td>Par</td><td class="r">${name(session.closedBy)}</td></tr>` : ""}${session.terminal ? `<tr><td>Terminal</td><td class="r">${esc(session.terminal.name)}</td></tr>` : ""}</table><hr>
<div class="big">Ventes par moyen de paiement</div><table>${Object.entries(summary.byMethod).map(([m, v]) => `<tr><td>${esc(METHOD[m] ?? m)} (${v.count})</td><td class="r">${f(v.amount - v.refunded)}</td></tr>`).join("")}<tr class="big"><td>Total encaissé</td><td class="r">${f(summary.totalSales)}</td></tr></table><hr>
<div class="big">Espèces</div><table><tr><td>Fond de caisse</td><td class="r">${f(summary.openingFloat)}</td></tr><tr><td>Ventes espèces</td><td class="r">${f(summary.cashSales)}</td></tr><tr><td>Remboursements</td><td class="r">${f(summary.cashRefunds)}</td></tr><tr><td>Entrées</td><td class="r">${f(summary.payIns)}</td></tr><tr><td>Sorties</td><td class="r">${f(summary.payOuts)}</td></tr><tr><td>Dépôts</td><td class="r">${f(summary.deposits)}</td></tr>${summary.corrections ? `<tr><td>Corrections</td><td class="r">${f(summary.corrections)}</td></tr>` : ""}<tr class="big"><td>Espèces théoriques</td><td class="r">${f(summary.cashExpected)}</td></tr>${summary.countedCash !== null ? `<tr><td>Espèces comptées</td><td class="r">${f(summary.countedCash)}</td></tr><tr class="big"><td>Écart</td><td class="r">${f(summary.difference ?? 0)}</td></tr>` : ""}</table><hr>
<div class="big">Mouvements</div><table>${session.movements.filter((m) => m.kind !== "SALE").map((m) => `<tr><td>${KIND[m.kind]} ${esc(m.reason)}</td><td class="r">${f(m.amount)}</td></tr>`).join("")}</table>
<hr><div class="c">ManaResto · ${formatDateTime(new Date(), tz)}</div><button class="btn" onclick="window.print()">Imprimer</button></div></body></html>`;
  return printableHtml(html);
});
