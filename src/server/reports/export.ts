import { prisma } from "@/server/db";
import { formatMoney } from "@/lib/money";
import { endOfLocalDay, formatDate, formatDateTime, startOfLocalDay } from "@/lib/dates";
import { getPeriodReport } from "@/server/services/reports";
import { staffSummary } from "@/server/services/staff";

/**
 * Exports CSV / Excel / PDF (Phase 5) : rapport de période, ventes par produit,
 * liste des commandes, heures et coût du personnel.
 */
export type ExportType = "period" | "products" | "orders" | "staff" | "accounting";
export type ExportFormat = "csv" | "xlsx" | "pdf";

const METHOD: Record<string, string> = { CASH: "Espèces", CARD: "Carte bancaire", CHECK: "Chèque", TRANSFER: "Virement", MEAL_VOUCHER: "Ticket restaurant", COMPLIMENTARY: "Offert", OTHER: "Autre" };
const TYPE: Record<string, string> = { DINE_IN: "Sur place", COUNTER: "Comptoir", TAKEAWAY: "À emporter", DELIVERY: "Livraison", ONLINE: "En ligne", KIOSK: "Borne" };
const STATUS: Record<string, string> = { PAID: "Payée", CANCELLED: "Annulée" };

type Sheet = { name: string; head: string[]; rows: (string | number | null)[][] };

/** Construit les feuilles de données d'un export (communes aux trois formats). */
export async function buildExport(establishmentId: string, type: ExportType, fromDay: string, toDay: string, timezone: string): Promise<{ title: string; sheets: Sheet[] }> {
  const period = `${fromDay} → ${toDay}`;
  if (type === "period") {
    const r = await getPeriodReport(establishmentId, fromDay, toDay, timezone);
    const kpi: Sheet = { name: "Synthèse", head: ["Indicateur", "Valeur", "Période précédente"], rows: [
      ["Période", period, r.previous ? `${r.previous.from} → ${r.previous.to}` : null], ["CA TTC", r.revenue, r.previous?.revenue ?? null], ["CA HT", r.revenueHt, r.previous?.revenueHt ?? null], ["TVA", r.tax, null],
      ["Tickets", r.tickets, r.previous?.tickets ?? null], ["Couverts", r.covers, r.previous?.covers ?? null], ["Panier moyen", r.avgTicket, r.previous?.avgTicket ?? null], ["CA / couvert", r.avgPerCover, null],
      ["Remises", r.discounts, null], ["Remboursements", r.refunds, null], ["Annulations", r.cancellations, null], ["Coût matière", r.foodCost, null], ["Ratio coût matière %", r.foodCostPct ?? "", r.previous?.foodCostPct ?? null],
    ] };
    return { title: `Rapport ${period}`, sheets: [kpi,
      { name: "Par jour", head: ["Jour", "CA TTC", "Tickets", "Couverts"], rows: r.byDay.map((d) => [d.day, d.revenue, d.tickets, d.covers]) },
      { name: "Par catégorie", head: ["Catégorie", "CA TTC", "Quantité", "Part %"], rows: r.byCategory.map((c) => [c.name, c.revenue, c.quantity, c.share]) },
      { name: "Top produits", head: ["Produit", "CA TTC", "Quantité"], rows: r.byProduct.map((p) => [p.name, p.revenue, p.quantity]) },
      { name: "Par serveur", head: ["Serveur", "CA TTC", "Tickets", "Panier moyen"], rows: r.byServer.map((s) => [s.name, s.revenue, s.tickets, s.avgTicket]) },
      { name: "Par paiement", head: ["Moyen", "Montant", "Nombre"], rows: r.byMethod.map((m) => [METHOD[m.method] ?? m.method, m.amount, m.count]) },
      { name: "Par heure", head: ["Heure", "CA TTC", "Tickets"], rows: r.byHour.map((h) => [`${h.hour}h`, h.revenue, h.tickets]) },
      { name: "Par jour de semaine", head: ["Jour", "CA TTC", "Tickets"], rows: r.byWeekday.map((w) => [w.label, w.revenue, w.tickets]) },
    ] };
  }
  if (type === "products") {
    const r = await getPeriodReport(establishmentId, fromDay, toDay, timezone, false);
    const items = await prisma.orderItem.findMany({ where: { order: { establishmentId, status: "PAID", closedAt: { gte: startOfLocalDay(fromDay, timezone), lt: endOfLocalDay(toDay, timezone) } }, status: { not: "VOIDED" }, parentItemId: null }, select: { name: true, quantity: true, lineTotal: true, taxAmount: true, costPrice: true, taxRateName: true, product: { select: { sku: true, category: { select: { name: true } } } }, menuId: true } });
    const map = new Map<string, { sku: string; category: string; quantity: number; revenue: number; tax: number; cost: number }>();
    for (const it of items) { const e = map.get(it.name) ?? { sku: it.product?.sku ?? "", category: it.product?.category?.name ?? (it.menuId ? "Formules" : ""), quantity: 0, revenue: 0, tax: 0, cost: 0 }; e.quantity += it.quantity; e.revenue += it.lineTotal; e.tax += it.taxAmount; e.cost += it.costPrice * it.quantity; map.set(it.name, e); }
    const rows = [...map.entries()].sort((a, b) => b[1].revenue - a[1].revenue).map(([name, v]) => [name, v.sku, v.category, v.quantity, v.revenue, v.revenue - v.tax, v.tax, v.cost, v.revenue > 0 ? Math.round(((v.revenue - v.tax - v.cost) / (v.revenue - v.tax)) * 1000) / 10 : "", r.revenue > 0 ? Math.round((v.revenue / r.revenue) * 1000) / 10 : 0]);
    return { title: `Ventes par produit ${period}`, sheets: [{ name: "Produits", head: ["Produit", "SKU", "Catégorie", "Quantité", "CA TTC", "CA HT", "TVA", "Coût matière", "Marge %", "Part CA %"], rows }] };
  }
  if (type === "orders") {
    const orders = await prisma.order.findMany({ where: { establishmentId, status: { in: ["PAID", "CANCELLED"] }, closedAt: { gte: startOfLocalDay(fromDay, timezone), lt: endOfLocalDay(toDay, timezone) } }, orderBy: { closedAt: "asc" }, include: { table: { select: { name: true } }, server: { select: { firstName: true, displayName: true } }, payments: true, _count: { select: { items: true } } } });
    const rows = orders.map((o) => [o.number, formatDateTime(o.openedAt, timezone), o.closedAt ? formatDateTime(o.closedAt, timezone) : "", TYPE[o.type] ?? o.type, o.table?.name ?? "", o.covers, o.server?.displayName || o.server?.firstName || "", STATUS[o.status] ?? o.status, o.subtotal, o.discountTotal, o.taxTotal, o.total, o.tipTotal, o.payments.filter((p) => p.status !== "VOIDED").map((p) => `${METHOD[p.method] ?? p.method} ${p.amount - p.refundedAmount}${p.refundedAmount ? ` (remb. ${p.refundedAmount})` : ""}`).join(" + "), o.cancelReason ?? ""]);
    return { title: `Commandes ${period}`, sheets: [{ name: "Commandes", head: ["N°", "Ouverte", "Clôturée", "Type", "Table", "Couverts", "Serveur", "Statut", "Sous-total", "Remise", "TVA", "Total TTC", "Pourboire", "Paiements", "Motif annulation"], rows }] };
  }
  if (type === "accounting") return buildAccountingExport(establishmentId, fromDay, toDay, timezone);
  const s = await staffSummary(establishmentId, fromDay, toDay, timezone);
  const rows = s.rows.map((r) => [`${r.firstName} ${r.lastName}`, r.jobTitle ?? "", r.hours, r.breakHours, r.plannedHours, r.variance, r.hourlyCost ?? "", r.cost]);
  rows.push(["TOTAL", "", s.totalHours, "", s.totalPlannedHours, "", "", s.totalCost]);
  return { title: `Personnel ${period}`, sheets: [{ name: "Heures", head: ["Employé", "Poste", "Heures travaillées", "Pauses (h)", "Heures planifiées", "Écart (h)", "Coût horaire", "Coût"], rows }, { name: "Synthèse", head: ["Indicateur", "Valeur"], rows: [["CA HT", s.revenueHt], ["Coût du personnel", s.totalCost], ["Coût personnel %", s.laborCostPct ?? ""], ["CA HT / heure travaillée", s.revenuePerHour ?? ""]] }] };
}

export function toCsv(sheets: Sheet[]): string {
  // Texte commençant par = + - @ (ou tabulation / retour) : préfixé d'une apostrophe pour qu'Excel ne l'exécute pas comme formule
  const esc = (v: string | number | null) => {
    if (typeof v === "number") return String(v);
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + sheets.map((sh) => `# ${sh.name}\n${sh.head.map(esc).join(";")}\n${sh.rows.map((r) => r.map(esc).join(";")).join("\n")}`).join("\n\n");
}

export async function toXlsx(sheets: Sheet[], title: string): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "ManaResto"; wb.created = new Date(); wb.title = title;
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31));
    ws.addRow(sh.head);
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0D8A86" } };
    for (const r of sh.rows) ws.addRow(r.map((v) => (v === null ? "" : v)));
    ws.columns.forEach((col) => { let w = 10; col.eachCell?.({ includeEmpty: false }, (c) => { w = Math.max(w, Math.min(60, String(c.value ?? "").length + 2)); }); col.width = w; });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** PDF A4 : titre, tableaux par feuille (jusqu'à 45 lignes par feuille pour rester lisible). */
export async function toPdf(sheets: Sheet[], title: string, establishmentName: string, currency: string): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 36, right: 36 }, info: { Title: title, Author: establishmentName } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const strip = (s: string) => [...s].map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : ch.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, ""))).join("");
  const W = 595 - 72;
  doc.rect(0, 0, 595, 70).fill("#0d8a86");
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(16).text(strip(establishmentName), 36, 22);
  doc.font("Helvetica").fontSize(10).text(strip(title), 36, 44);
  doc.fillColor("#0f172a");
  let y = 90;
  const moneyCols = new Set(["CA TTC", "CA HT", "TVA", "Montant", "Coût matière", "Coût", "Sous-total", "Remise", "Total TTC", "Pourboire", "Panier moyen", "CA / couvert", "Remises", "Remboursements", "Coût horaire"]);
  for (const sh of sheets) {
    const rows = sh.rows.slice(0, 45);
    const cols = sh.head.length;
    const colW = W / cols;
    if (y > 700) { doc.addPage(); y = 50; }
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#0d8a86").text(strip(sh.name), 36, y); y += 18;
    doc.rect(36, y, W, 16).fill("#f1f4f8"); doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(7.5);
    sh.head.forEach((h, i) => doc.text(strip(h), 40 + i * colW, y + 4, { width: colW - 6, align: i === 0 ? "left" : "right" }));
    y += 18; doc.font("Helvetica").fontSize(7.5);
    for (const r of rows) {
      if (y > 780) { doc.addPage(); y = 50; }
      r.forEach((v, i) => { const isMoney = typeof v === "number" && (sh.name === "Synthèse" ? v > 100 : moneyCols.has(sh.head[i])); doc.text(strip(v === null ? "" : typeof v === "number" && isMoney ? formatMoney(v, currency) : String(v)), 40 + i * colW, y, { width: colW - 6, align: i === 0 ? "left" : "right" }); });
      y += 12;
      doc.moveTo(36, y - 1).lineTo(36 + W, y - 1).strokeColor("#e4e9ef").lineWidth(0.4).stroke();
    }
    if (sh.rows.length > rows.length) { doc.fillColor("#64748b").text(strip(`… ${sh.rows.length - rows.length} lignes supplémentaires dans l'export Excel / CSV`), 40, y); doc.fillColor("#0f172a"); y += 12; }
    y += 14;
  }
  doc.fontSize(7).fillColor("#64748b").text(strip(`Généré par ManaResto le ${formatDate(new Date())}`), 36, 810);
  doc.end();
  return done;
}

/**
 * Export comptable (Phase 7) — Polynésie française (plan comptable général) :
 *  - Ventes par jour et par taux de TVA (HT, TVA, TTC), remises ;
 *  - Encaissements par jour et moyen de paiement (net des remboursements) ;
 *  - Écritures de journal (format import comptable : date, journal, compte, libellé, débit, crédit) :
 *    707 ventes HT par taux, 4457 TVA collectée, 53 caisse / 512 banque / 467 titres-restaurant, 6 remboursements.
 */
const ACCOUNTS: Record<string, [string, string]> = { CASH: ["530000", "Caisse"], CARD: ["512000", "Banque (CB)"], CHECK: ["512100", "Banque (chèques)"], TRANSFER: ["512200", "Banque (virements)"], MEAL_VOUCHER: ["467000", "Titres-restaurant"], COMPLIMENTARY: ["658000", "Offerts"], OTHER: ["471000", "Compte d'attente"] };

export async function buildAccountingExport(establishmentId: string, fromDay: string, toDay: string, timezone: string): Promise<{ title: string; sheets: Sheet[] }> {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { name: true, legalName: true, tahitiNumber: true } });
  const orders = await prisma.order.findMany({ where: { establishmentId, status: "PAID", closedAt: { gte: startOfLocalDay(fromDay, timezone), lt: endOfLocalDay(toDay, timezone) } }, orderBy: { closedAt: "asc" }, include: { items: { where: { status: { not: "VOIDED" } }, select: { lineTotal: true, taxAmount: true, taxRateBps: true, taxRateName: true } }, payments: { where: { status: { not: "VOIDED" } } } } });
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const byDayRate = new Map<string, { ht: number; tax: number; ttc: number }>();
  const byDayMethod = new Map<string, { amount: number; count: number; tips: number; refunded: number }>();
  const dayTotals = new Map<string, { ttc: number; discounts: number; tips: number; tickets: number }>();
  for (const o of orders) {
    const day = dayFmt.format(o.closedAt!);
    const ratio = o.subtotal > 0 ? o.total / o.subtotal : 1; // remise globale répartie au prorata
    for (const it of o.items) {
      const ttc = Math.round(it.lineTotal * ratio), tax = Math.round(it.taxAmount * ratio);
      const k = `${day}|${it.taxRateBps}|${it.taxRateName ?? ""}`;
      const e = byDayRate.get(k) ?? { ht: 0, tax: 0, ttc: 0 }; e.ttc += ttc; e.tax += tax; e.ht += ttc - tax; byDayRate.set(k, e);
    }
    for (const p of o.payments) { const k = `${day}|${p.method}`; const e = byDayMethod.get(k) ?? { amount: 0, count: 0, tips: 0, refunded: 0 }; e.amount += p.amount - p.refundedAmount; e.count++; e.tips += p.tipAmount; e.refunded += p.refundedAmount; byDayMethod.set(k, e); }
    const d = dayTotals.get(day) ?? { ttc: 0, discounts: 0, tips: 0, tickets: 0 }; d.ttc += o.total; d.discounts += o.discountTotal; d.tips += o.tipTotal; d.tickets++; dayTotals.set(day, d);
  }
  const sales: Sheet = { name: "Ventes par taux TVA", head: ["Jour", "Taux", "Libellé TVA", "HT", "TVA", "TTC"], rows: [...byDayRate.entries()].sort().map(([k, v]) => { const [day, bps, name] = k.split("|"); return [day, `${Number(bps) / 100} %`, name, v.ht, v.tax, v.ttc]; }) };
  const receipts: Sheet = { name: "Encaissements", head: ["Jour", "Moyen", "Compte", "Montant net", "Nombre", "Remboursé"], rows: [...byDayMethod.entries()].sort().map(([k, v]) => { const [day, m] = k.split("|"); return [day, METHOD[m] ?? m, ACCOUNTS[m]?.[0] ?? "", v.amount, v.count, v.refunded]; }) };
  const days: Sheet = { name: "Journal de caisse", head: ["Jour", "Tickets", "CA TTC", "Remises"], rows: [...dayTotals.entries()].sort().map(([day, v]) => [day, v.tickets, v.ttc, v.discounts]) };
  // Écritures : par jour, débit des comptes d'encaissement, crédit 707 (HT par taux) et 4457 (TVA)
  const entries: Sheet = { name: "Écritures", head: ["Date", "Journal", "Compte", "Libellé", "Débit", "Crédit"], rows: [] };
  for (const [day] of [...dayTotals.entries()].sort()) {
    for (const [k, v] of [...byDayMethod.entries()].filter(([k]) => k.startsWith(day + "|"))) { const m = k.split("|")[1]; const [acc, label] = ACCOUNTS[m] ?? ["471000", m]; if (v.amount) entries.rows.push([day, "VT", acc, `${label} — ventes ${day}`, v.amount, 0]); }
    for (const [k, v] of [...byDayRate.entries()].filter(([k]) => k.startsWith(day + "|"))) { const [, bps, name] = k.split("|"); entries.rows.push([day, "VT", `7070${String(Math.round(Number(bps) / 100)).padStart(2, "0")}`, `Ventes HT ${name || bps + " bps"} ${day}`, 0, v.ht]); if (v.tax) entries.rows.push([day, "VT", "445710", `TVA collectée ${name || bps + " bps"} ${day}`, 0, v.tax]); }
  }
  const period = `${fromDay} → ${toDay}`;
  const header: Sheet = { name: "Entête", head: ["Champ", "Valeur"], rows: [["Établissement", est.name], ["Raison sociale", est.legalName ?? ""], ["N° Tahiti", est.tahitiNumber ?? ""], ["Période", period], ["Devise", "XPF (F CFP), sans décimales"], ["Généré le", new Date().toISOString()]] };
  return { title: `Export comptable ${period}`, sheets: [header, days, sales, receipts, entries] };
}
