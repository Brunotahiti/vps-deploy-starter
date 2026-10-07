import { prisma } from "@/server/db";
import { endOfLocalDay, formatDateTime, formatTime, startOfLocalDay } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { EscPosBuilder, asciiFold, type PrintOp } from "@/server/hardware/escpos";
import { escapeHtml as esc } from "@/server/html";
import { getDailySummary, type DailySummary } from "./reports";
import { staffSummary } from "./staff";

/**
 * Récapitulatif de fin de service : tout ce qu'il faut savoir d'une journée en une page, à l'écran, en version
 * imprimable (A4) ou sur l'imprimante de caisse (ticket). Couverts, chiffre d'affaires, marge, remises, paiements,
 * caisses, serveurs, catégories, produits, heures de pointe, personnel (option Équipe).
 */
const METHOD: Record<string, string> = { CASH: "Espèces", CARD: "Carte bancaire", CHECK: "Chèque", TRANSFER: "Virement", MEAL_VOUCHER: "Ticket restaurant", COMPLIMENTARY: "Offert", OTHER: "Autre", ACCOUNT: "Sur compte", GIFT_CARD: "Carte cadeau" };
const TYPE: Record<string, string> = { DINE_IN: "Sur place", COUNTER: "Comptoir", TAKEAWAY: "À emporter", DELIVERY: "Livraison", ONLINE: "En ligne", KIOSK: "Borne" };

export type ServiceRecap = {
  day: string;
  establishment: { name: string; currency: string; timezone: string };
  generatedAt: string;
  /** Première ouverture et dernière clôture de commande de la journée */
  service: { firstOrderAt: string | null; lastOrderAt: string | null; openOrders: number };
  summary: DailySummary;
  /** CA net des remboursements */
  refunds: number;
  netRevenue: number;
  /** Marge brute HT = CA HT − coût matière (null si aucun coût renseigné) ; visible seulement avec le droit Rapports */
  margin: { gross: number; pct: number | null; foodCost: number; foodCostPct: number | null; unknownCostProducts: number } | null;
  byType: { type: string; label: string; revenue: number; tickets: number; covers: number }[];
  cash: { id: string; status: string; terminal: string | null; openedBy: string; closedBy: string | null; openedAt: string; closedAt: string | null; openingFloat: number; cashSales: number; payIns: number; payOuts: number; expectedCash: number; countedCash: number | null; difference: number | null }[];
  kitchen: { tickets: number; avgPrepSec: number | null; slowest: number | null };
  staff: { hours: number; cost: number; laborCostPct: number | null } | null;
  peakHour: { hour: number; revenue: number; tickets: number } | null;
};

const name = (u: { firstName: string; lastName: string; displayName: string | null } | null | undefined) => (u ? u.displayName || `${u.firstName} ${u.lastName}`.trim() : "—");

export async function getServiceRecap(establishmentId: string, day: string, opts: { withMargin: boolean; withStaff: boolean }): Promise<ServiceRecap> {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { name: true, currency: true, timezone: true } });
  const tz = est.timezone;
  const from = startOfLocalDay(day, tz), to = endOfLocalDay(day, tz);
  const [summary, orders, sessions, tickets, staff] = await Promise.all([
    getDailySummary(establishmentId, day, tz),
    prisma.order.findMany({ where: { establishmentId, closedAt: { gte: from, lt: to }, status: "PAID" }, select: { type: true, total: true, covers: true, openedAt: true, closedAt: true, payments: { select: { refundedAmount: true } } } }),
    prisma.cashSession.findMany({
      where: { establishmentId, OR: [{ openedAt: { gte: from, lt: to } }, { closedAt: { gte: from, lt: to } }, { status: "OPEN", openedAt: { lt: to } }] },
      orderBy: { openedAt: "asc" },
      include: { openedBy: { select: { firstName: true, lastName: true, displayName: true } }, closedBy: { select: { firstName: true, lastName: true, displayName: true } }, terminal: { select: { name: true } }, movements: { select: { kind: true, amount: true } } },
    }),
    prisma.kitchenTicket.findMany({ where: { order: { establishmentId }, createdAt: { gte: from, lt: to }, readyAt: { not: null } }, select: { createdAt: true, readyAt: true } }),
    opts.withStaff ? staffSummary(establishmentId, day, day, tz).catch(() => null) : Promise.resolve(null),
  ]);
  const refunds = orders.reduce((a, o) => a + o.payments.reduce((b, p) => b + p.refundedAmount, 0), 0);
  const byType = new Map<string, { revenue: number; tickets: number; covers: number }>();
  for (const o of orders) { const t = byType.get(o.type) ?? { revenue: 0, tickets: 0, covers: 0 }; t.revenue += o.total; t.tickets++; t.covers += o.covers; byType.set(o.type, t); }
  const prep = tickets.map((t) => (t.readyAt!.getTime() - t.createdAt.getTime()) / 1000);
  const sum = (ms: { kind: string; amount: number }[], kinds: string[]) => ms.filter((m) => kinds.includes(m.kind)).reduce((a, m) => a + m.amount, 0);
  const gross = summary.revenueHt - summary.foodCost;
  return {
    day,
    establishment: est,
    generatedAt: new Date().toISOString(),
    service: {
      firstOrderAt: orders.length ? new Date(Math.min(...orders.map((o) => o.openedAt.getTime()))).toISOString() : null,
      lastOrderAt: orders.length ? new Date(Math.max(...orders.map((o) => o.closedAt!.getTime()))).toISOString() : null,
      openOrders: summary.openOrders,
    },
    summary,
    refunds, netRevenue: summary.revenue - refunds,
    margin: opts.withMargin ? { gross, pct: summary.revenueHt > 0 ? Math.round((gross / summary.revenueHt) * 1000) / 10 : null, foodCost: summary.foodCost, foodCostPct: summary.foodCostPct, unknownCostProducts: summary.profitability.unknownCost } : null,
    byType: [...byType.entries()].map(([type, v]) => ({ type, label: TYPE[type] ?? type, ...v })).sort((a, b) => b.revenue - a.revenue),
    cash: sessions.map((s) => ({
      id: s.id, status: s.status, terminal: s.terminal?.name ?? null, openedBy: name(s.openedBy), closedBy: s.closedBy ? name(s.closedBy) : null,
      openedAt: s.openedAt.toISOString(), closedAt: s.closedAt?.toISOString() ?? null, openingFloat: s.openingFloat,
      cashSales: sum(s.movements, ["SALE", "REFUND"]), payIns: sum(s.movements, ["PAY_IN", "DEPOSIT"]), payOuts: sum(s.movements, ["PAY_OUT", "CORRECTION"]),
      expectedCash: s.status === "CLOSED" ? (s.expectedCash ?? 0) : s.movements.reduce((a, m) => a + m.amount, 0), countedCash: s.countedCash, difference: s.difference,
    })),
    kitchen: { tickets: tickets.length, avgPrepSec: prep.length ? Math.round(prep.reduce((a, b) => a + b, 0) / prep.length) : null, slowest: prep.length ? Math.round(Math.max(...prep)) : null },
    staff: staff ? { hours: staff.totalHours, cost: staff.totalCost, laborCostPct: staff.laborCostPct } : null,
    peakHour: summary.byHour.length ? [...summary.byHour].sort((a, b) => b.revenue - a.revenue)[0] : null,
  };
}

const longDate = (day: string) => new Date(day + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const mmss = (s: number) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Ticket thermique du récapitulatif (imprimante de caisse). */
export function renderRecapDoc(r: ServiceRecap, cols = 42): PrintOp[] {
  const f = (n: number) => formatMoney(n, r.establishment.currency);
  const s = r.summary;
  const b = new EscPosBuilder(cols);
  b.align("center").bold(true).size(2, 2).line(r.establishment.name).size(1, 1).bold(false);
  b.size(1, 2).line("FIN DE SERVICE").size(1, 1).line(longDate(r.day));
  if (r.service.firstOrderAt && r.service.lastOrderAt) b.line(`de ${formatTime(r.service.firstOrderAt, r.establishment.timezone)} a ${formatTime(r.service.lastOrderAt, r.establishment.timezone)}`);
  b.align("left").separator("=");
  b.bold(true).size(1, 2).row("COUVERTS", String(s.covers)).row("TICKETS", String(s.tickets)).size(1, 1).bold(false);
  b.row("Ticket moyen", f(s.avgTicket)).row("Par couvert", f(s.avgPerCover));
  b.separator();
  b.bold(true).size(1, 2).row("CA TTC", f(s.revenue)).size(1, 1).bold(false);
  b.row("CA HT", f(s.revenueHt)).row("TVA", f(s.tax));
  if (s.discounts) b.row("Remises", `-${f(s.discounts)}`);
  if (r.refunds) b.row("Remboursements", `-${f(r.refunds)}`).row("CA net", f(r.netRevenue));
  if (s.cancellations) b.row("Commandes annulees", String(s.cancellations));
  if (r.service.openOrders) b.row("Encore ouvertes", String(r.service.openOrders));
  if (r.margin) {
    b.separator();
    b.row("Cout matiere", `${f(r.margin.foodCost)}${r.margin.foodCostPct !== null ? ` (${r.margin.foodCostPct} %)` : ""}`);
    b.bold(true).row("MARGE BRUTE HT", `${f(r.margin.gross)}${r.margin.pct !== null ? ` (${r.margin.pct} %)` : ""}`).bold(false);
    if (r.margin.unknownCostProducts) b.line(`(${r.margin.unknownCostProducts} produit${r.margin.unknownCostProducts > 1 ? "s" : ""} sans cout renseigne)`);
  }
  if (r.staff) { b.separator(); b.row("Personnel", `${r.staff.hours} h · ${f(r.staff.cost)}`); if (r.staff.laborCostPct !== null) b.row("Ratio personnel", `${r.staff.laborCostPct} %`); }
  if (s.byMethod.length) { b.separator("="); b.bold(true).line("ENCAISSEMENTS").bold(false); for (const m of s.byMethod) b.row(`${METHOD[m.method] ?? m.method} (${m.count})`, f(m.amount)); }
  if (r.cash.length) {
    b.separator("="); b.bold(true).line("CAISSES").bold(false);
    for (const c of r.cash) {
      b.line(`${c.terminal ?? "Caisse"} · ${c.openedBy} · ${c.status === "CLOSED" ? "cloturee" : "OUVERTE"}`);
      b.row("  Fond", f(c.openingFloat)).row("  Ventes especes", f(c.cashSales));
      if (c.payIns || c.payOuts) b.row("  Entrees / sorties", `${f(c.payIns)} / ${f(c.payOuts)}`);
      b.row("  Especes theoriques", f(c.expectedCash));
      if (c.countedCash !== null) b.row("  Comptees", f(c.countedCash)).bold(true).row("  Ecart", f(c.difference ?? 0)).bold(false);
    }
  }
  if (r.byType.length > 1) { b.separator("="); b.bold(true).line("PAR TYPE DE VENTE").bold(false); for (const t of r.byType) b.row(`${t.label} (${t.tickets})`, f(t.revenue)); }
  if (s.byServer.length) { b.separator("="); b.bold(true).line("PAR SERVEUR").bold(false); for (const x of s.byServer) b.row(`${x.name} (${x.tickets})`, f(x.revenue)); }
  if (s.byCategory.length) { b.separator("="); b.bold(true).line("PAR CATEGORIE").bold(false); for (const c of s.byCategory) b.row(`${c.name} (x${c.quantity})`, f(c.revenue)); }
  if (s.byProduct.length) { b.separator("="); b.bold(true).line("TOP PRODUITS").bold(false); for (const p of s.byProduct.slice(0, 10)) b.row(`${p.quantity} x ${p.name}`, f(p.revenue)); }
  if (r.kitchen.tickets) { b.separator("="); b.bold(true).line("CUISINE").bold(false); b.row("Bons prets", String(r.kitchen.tickets)); if (r.kitchen.avgPrepSec !== null) b.row("Preparation moyenne", mmss(r.kitchen.avgPrepSec)); if (r.kitchen.slowest !== null) b.row("Le plus long", mmss(r.kitchen.slowest)); }
  if (r.peakHour) { b.separator(); b.row("Heure de pointe", `${r.peakHour.hour} h · ${f(r.peakHour.revenue)}`); }
  if (s.previous) { b.separator(); b.line(`Il y a 7 jours : ${s.previous.covers} couv. · ${f(s.previous.revenue)}`); }
  b.separator("=").align("center").line(`ManaResto · ${formatDateTime(r.generatedAt, r.establishment.timezone)}`).line("Mauruuru a toute l'equipe !").feed(3).cut();
  // Les imprimantes thermiques n'ont pas toujours les accents : texte replié en ASCII
  return b.ops().map((op) => (op.t === "text" ? { ...op, s: asciiFold(op.s) } : op));
}

/** Page imprimable (A4) du récapitulatif : propre, lisible, prête pour l'imprimante de bureau ou l'enregistrement en PDF. */
export function renderRecapHtml(r: ServiceRecap): string {
  const f = (n: number) => formatMoney(n, r.establishment.currency);
  const s = r.summary;
  const tz = r.establishment.timezone;
  const pct = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("fr-FR")} %`);
  const tile = (label: string, value: string, sub = "") => `<div class="tile"><div class="l">${esc(label)}</div><div class="v">${esc(value)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ""}</div>`;
  const table = (title: string, head: string[], rows: (string | number)[][]) => rows.length ? `<section><h2>${esc(title)}</h2><table><thead><tr>${head.map((h, i) => `<th class="${i ? "r" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c, i) => `<td class="${i ? "r" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></section>` : "";
  const delta = s.previous && s.previous.revenue > 0 ? Math.round(((s.revenue - s.previous.revenue) / s.previous.revenue) * 100) : null;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fin de service · ${esc(longDate(r.day))}</title>
<style>
:root{color-scheme:light}body{font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#0f172a;background:#fff;margin:0;padding:24px;font-size:13px}
.page{max-width:820px;margin:0 auto}header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0ea5a4;padding-bottom:10px;margin-bottom:16px}
h1{font-size:24px;margin:0;letter-spacing:-.01em}h1 small{display:block;font-size:13px;font-weight:600;color:#475569;margin-top:2px}.when{text-align:right;color:#475569;font-size:12px}
.hero{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}.tile{border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;background:#f8fafc}.tile.big{background:#0ea5a4;color:#fff;border-color:#0ea5a4}
.l{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b}.big .l{color:#ccfbf1}.v{font-size:20px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums}.s{font-size:11px;color:#64748b;margin-top:2px}.big .s{color:#ccfbf1}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 24px}section{break-inside:avoid;margin-bottom:12px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#0ea5a4;margin:0 0 4px;border-bottom:1px solid #e2e8f0;padding-bottom:3px}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:10px;color:#64748b;font-weight:700;padding:3px 0}td{padding:3px 0;border-top:1px solid #f1f5f9;font-variant-numeric:tabular-nums}.r{text-align:right;white-space:nowrap}tr.total td{font-weight:800;border-top:2px solid #0f172a}
.note{font-size:11px;color:#64748b}.btn{position:fixed;right:16px;bottom:16px;padding:12px 18px;background:#0ea5a4;color:#fff;border:0;border-radius:12px;font-size:14px;font-weight:700;box-shadow:0 8px 24px -8px rgb(14 165 164/.6)}
footer{margin-top:16px;border-top:1px solid #e2e8f0;padding-top:8px;font-size:11px;color:#64748b;display:flex;justify-content:space-between}
@media print{body{padding:0}.btn{display:none}@page{margin:14mm}}
</style></head><body><div class="page">
<header><h1>Récapitulatif de fin de service<small>${esc(r.establishment.name)}</small></h1><div class="when"><b>${esc(longDate(r.day))}</b>${r.service.firstOrderAt && r.service.lastOrderAt ? `<br>Service de ${formatTime(r.service.firstOrderAt, tz)} à ${formatTime(r.service.lastOrderAt, tz)}` : ""}</div></header>
<div class="hero">
${tile("Chiffre d'affaires TTC", f(s.revenue), delta !== null ? `${delta >= 0 ? "+" : ""}${delta} % vs il y a 7 jours` : "").replace('class="tile"', 'class="tile big"')}
${tile("Couverts", String(s.covers), `${f(s.avgPerCover)} par couvert`)}
${tile("Tickets", String(s.tickets), `ticket moyen ${f(s.avgTicket)}`)}
${r.margin ? tile("Marge brute HT", f(r.margin.gross), `${pct(r.margin.pct)} du CA HT · coût matière ${pct(r.margin.foodCostPct)}`) : tile("CA HT", f(s.revenueHt), `TVA ${f(s.tax)}`)}
</div>
${s.tickets === 0 ? `<p class="note" style="font-size:14px;padding:12px;border:1px dashed #cbd5e1;border-radius:12px;text-align:center">Aucune vente encaissée ce jour${r.service.openOrders ? ` · ${r.service.openOrders} commande${r.service.openOrders > 1 ? "s" : ""} encore ouverte${r.service.openOrders > 1 ? "s" : ""}` : ""}.</p>` : ""}
<div class="grid">
<section><h2>Chiffres</h2><table>
<tr><td>CA TTC</td><td class="r">${f(s.revenue)}</td></tr><tr><td>CA HT</td><td class="r">${f(s.revenueHt)}</td></tr><tr><td>TVA collectée</td><td class="r">${f(s.tax)}</td></tr>
<tr><td>Remises accordées</td><td class="r">−${f(s.discounts)}</td></tr><tr><td>Remboursements</td><td class="r">−${f(r.refunds)}</td></tr><tr class="total"><td>CA net encaissé</td><td class="r">${f(r.netRevenue)}</td></tr>
<tr><td>Commandes annulées</td><td class="r">${s.cancellations}</td></tr>${r.service.openOrders ? `<tr><td>Commandes encore ouvertes</td><td class="r">${r.service.openOrders}</td></tr>` : ""}
${r.margin ? `<tr><td>Coût matière</td><td class="r">${f(r.margin.foodCost)} (${pct(r.margin.foodCostPct)})</td></tr><tr class="total"><td>Marge brute HT</td><td class="r">${f(r.margin.gross)} (${pct(r.margin.pct)})</td></tr>${r.margin.unknownCostProducts ? `<tr><td colspan="2" class="note">${r.margin.unknownCostProducts} produit${r.margin.unknownCostProducts > 1 ? "s" : ""} vendu${r.margin.unknownCostProducts > 1 ? "s" : ""} sans coût renseigné : la marge réelle est un peu plus basse.</td></tr>` : ""}` : ""}
${r.staff ? `<tr><td>Personnel : ${r.staff.hours} h travaillées</td><td class="r">${f(r.staff.cost)}${r.staff.laborCostPct !== null ? ` (${pct(r.staff.laborCostPct)})` : ""}</td></tr>` : ""}
</table></section>
${table("Encaissements", ["Moyen de paiement", "Nb", "Montant"], [...s.byMethod.map((m) => [METHOD[m.method] ?? m.method, m.count, f(m.amount)]), ["Total encaissé", s.byMethod.reduce((a, m) => a + m.count, 0), f(s.byMethod.reduce((a, m) => a + m.amount, 0))]])}
${r.cash.length ? `<section><h2>Caisses</h2>${r.cash.map((c) => `<table><tr><th colspan="2">${esc(c.terminal ?? "Caisse")} · ouverte par ${esc(c.openedBy)} à ${formatTime(c.openedAt, tz)}${c.closedAt ? ` · clôturée par ${esc(c.closedBy ?? "")} à ${formatTime(c.closedAt, tz)}` : " · <b>encore ouverte</b>"}</th></tr><tr><td>Fond de caisse</td><td class="r">${f(c.openingFloat)}</td></tr><tr><td>Ventes espèces (net)</td><td class="r">${f(c.cashSales)}</td></tr>${c.payIns || c.payOuts ? `<tr><td>Entrées / sorties</td><td class="r">${f(c.payIns)} / ${f(c.payOuts)}</td></tr>` : ""}<tr><td>Espèces théoriques</td><td class="r">${f(c.expectedCash)}</td></tr>${c.countedCash !== null ? `<tr><td>Espèces comptées</td><td class="r">${f(c.countedCash)}</td></tr><tr class="total"><td>Écart</td><td class="r">${f(c.difference ?? 0)}</td></tr>` : ""}</table>`).join("")}</section>` : ""}
${r.byType.length > 1 ? table("Par type de vente", ["Type", "Tickets", "Couverts", "CA"], r.byType.map((t) => [t.label, t.tickets, t.covers, f(t.revenue)])) : ""}
${table("Par serveur", ["Serveur", "Tickets", "CA"], s.byServer.map((x) => [x.name, x.tickets, f(x.revenue)]))}
${table("Par catégorie", ["Catégorie", "Qté", "CA"], s.byCategory.map((c) => [c.name, c.quantity, f(c.revenue)]))}
${table("Produits les plus vendus", ["Produit", "Qté", "CA", ...(r.margin ? ["Marge"] : [])], s.byProduct.slice(0, 15).map((p) => [p.name, p.quantity, f(p.revenue), ...(r.margin ? [p.marginPct === null ? "—" : `${p.marginPct} %`] : [])]))}
${table("Ventes par heure", ["Heure", "Tickets", "CA"], s.byHour.map((h) => [`${h.hour} h – ${h.hour + 1} h${r.peakHour?.hour === h.hour ? " ★" : ""}`, h.tickets, f(h.revenue)]))}
${r.kitchen.tickets ? `<section><h2>Cuisine</h2><table><tr><td>Bons passés en « prêt »</td><td class="r">${r.kitchen.tickets}</td></tr>${r.kitchen.avgPrepSec !== null ? `<tr><td>Temps de préparation moyen</td><td class="r">${mmss(r.kitchen.avgPrepSec)}</td></tr>` : ""}${r.kitchen.slowest !== null ? `<tr><td>Le plus long</td><td class="r">${mmss(r.kitchen.slowest)}</td></tr>` : ""}</table></section>` : ""}
</div>
<footer><span>ManaResto · édité le ${formatDateTime(r.generatedAt, tz)}</span><span>${s.previous ? `Il y a 7 jours : ${s.previous.covers} couverts · ${s.previous.tickets} tickets · ${f(s.previous.revenue)}` : ""}</span></footer>
<button class="btn" onclick="window.print()">Imprimer</button>
</div></body></html>`;
}
