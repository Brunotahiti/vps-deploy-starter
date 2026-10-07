import { prisma } from "@/server/db";
import { formatMoney } from "@/lib/money";
import { endOfLocalDay, formatDate, formatDateTime, startOfLocalDay } from "@/lib/dates";
import { getPeriodReport } from "@/server/services/reports";
import { staffSummary } from "@/server/services/staff";
import { getAccountingSummary, listExpenses } from "@/server/services/accounting";
import { listIngredients, listMovements } from "@/server/services/stock";

/**
 * Exports CSV / Excel / PDF (Phase 5) : rapport de période, ventes par produit,
 * liste des commandes, heures et coût du personnel.
 */
export type ExportType = "period" | "products" | "orders" | "staff" | "accounting" | "expenses" | "stock";
export type ExportFormat = "csv" | "xlsx" | "pdf";

const METHOD: Record<string, string> = { CASH: "Espèces", CARD: "Carte bancaire", CHECK: "Chèque", TRANSFER: "Virement", MEAL_VOUCHER: "Ticket restaurant", COMPLIMENTARY: "Offert", OTHER: "Autre", ACCOUNT: "Sur compte", GIFT_CARD: "Carte cadeau" };
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
      ["Remises", r.discounts, null], ["Remboursements", r.refunds, null], ["CA TTC net des remboursements", r.netRevenue, null], ["Annulations", r.cancellations, null], ["Coût matière", r.foodCost, null], ["Ratio coût matière %", r.foodCostPct ?? "", r.previous?.foodCostPct ?? null],
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
  if (type === "expenses") {
    const rows = await listExpenses(establishmentId, startOfLocalDay(fromDay, timezone), endOfLocalDay(toDay, timezone));
    return { title: `Dépenses ${period}`, sheets: [{ name: "Dépenses", head: ["Date", "Libellé", "Catégorie", "Compte", "Fournisseur", "Référence", "TTC", "TVA déductible", "HT", "Paiement", "Payée le", "Notes"], rows: rows.map((e) => [formatDate(e.date, timezone), e.label, e.categoryLabel, e.account, e.supplierName ?? e.supplier?.name ?? "", e.reference ?? "", e.amountTtc, e.taxAmount, e.amountHt, e.method ? METHOD[e.method] ?? e.method : "À payer", e.paidAt ? formatDate(e.paidAt, timezone) : "", e.notes ?? ""]) }] };
  }
  if (type === "stock") {
    const [ings, moves] = await Promise.all([listIngredients(establishmentId, { includeInactive: false }), listMovements(establishmentId, { from: startOfLocalDay(fromDay, timezone), to: endOfLocalDay(toDay, timezone), take: 5000 })]);
    const MOVE: Record<string, string> = { SALE: "Vente", PURCHASE: "Achat", ADJUSTMENT: "Ajustement", LOSS: "Perte", BREAKAGE: "Casse", INTERNAL_USE: "Usage interne", INVENTORY: "Inventaire", PRODUCTION: "Production" };
    const valuation: Sheet = { name: "Valorisation du stock", head: ["Ingrédient", "Type", "Unité", "Stock", "Seuil", "Coût moyen", "Valeur", "Dernier coût"], rows: ings.map((i) => [i.name, i.isPreparation ? "Préparation" : "Ingrédient", i.unit, i.stockQty, i.stockMin, i.avgCost, i.value, i.lastCost]) };
    valuation.rows.push(["TOTAL", "", "", "", "", "", ings.reduce((a, i) => a + i.value, 0), ""]);
    const journal: Sheet = { name: "Mouvements", head: ["Date", "Ingrédient", "Unité", "Type", "Quantité", "Coût unit.", "Valeur", "Motif", "Par"], rows: moves.map((m) => [formatDateTime(m.createdAt, timezone), m.ingredient.name, m.ingredient.unit, MOVE[m.kind] ?? m.kind, m.quantity, m.unitCost ?? "", m.value ?? "", m.reason ?? "", m.user?.displayName || m.user?.firstName || ""]) };
    return { title: `Stock ${period}`, sheets: [valuation, journal] };
  }
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
  const moneyCols = new Set(["CA TTC", "CA HT", "TVA", "Montant", "Coût matière", "Coût", "Sous-total", "Remise", "Total TTC", "Pourboire", "Panier moyen", "CA / couvert", "Remises", "Remboursements", "Coût horaire", "TTC", "HT", "TVA déductible", "Débit", "Crédit", "Valeur", "Coût moyen", "Dernier coût", "Coût unit.", "Encaissé", "Remboursé", "Net"]);
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
      r.forEach((v, i) => { const isMoney = typeof v === "number" && (sh.name === "Synthèse" || sh.name === "Résultat" ? Math.abs(v) > 100 : moneyCols.has(sh.head[i])); doc.text(strip(v === null ? "" : typeof v === "number" && isMoney ? formatMoney(v, currency) : String(v)), 40 + i * colW, y, { width: colW - 6, align: i === 0 ? "left" : "right" }); });
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
 *    707 ventes HT par taux, 4457 TVA collectée, 53 caisse / 512 banque / 467 titres-restaurant ;
 *  - Remboursements à leur date réelle : 709 (HT) et 4457 (TVA reprise) au débit, compte d'encaissement au crédit.
 *  Chaque journée est équilibrée (écart d'arrondi éventuel en 658/758).
 */
const ACCOUNTS: Record<string, [string, string]> = { CASH: ["530000", "Caisse"], CARD: ["512000", "Banque (CB)"], CHECK: ["512100", "Banque (chèques)"], TRANSFER: ["512200", "Banque (virements)"], MEAL_VOUCHER: ["467000", "Titres-restaurant"], COMPLIMENTARY: ["658000", "Offerts"], OTHER: ["471000", "Compte d'attente"], ACCOUNT: ["411000", "Clients (comptes pro)"], GIFT_CARD: ["419100", "Cartes cadeaux (avances clients)"] };

export async function buildAccountingExport(establishmentId: string, fromDay: string, toDay: string, timezone: string): Promise<{ title: string; sheets: Sheet[] }> {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { name: true, legalName: true, tahitiNumber: true } });
  const orders = await prisma.order.findMany({ where: { establishmentId, status: "PAID", closedAt: { gte: startOfLocalDay(fromDay, timezone), lt: endOfLocalDay(toDay, timezone) } }, orderBy: { closedAt: "asc" }, include: { items: { where: { status: { not: "VOIDED" } }, select: { lineTotal: true, taxAmount: true, taxRateBps: true, taxRateName: true } }, payments: { where: { status: { not: "VOIDED" } } } } });
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const byDayRate = new Map<string, { ht: number; tax: number; ttc: number }>();
  const byDayMethod = new Map<string, { amount: number; count: number; tips: number; refunded: number }>();
  const dayTotals = new Map<string, { ttc: number; discounts: number; tips: number; tickets: number; refunds: number }>();
  const dayOf = (day: string) => { let d = dayTotals.get(day); if (!d) { d = { ttc: 0, discounts: 0, tips: 0, tickets: 0, refunds: 0 }; dayTotals.set(day, d); } return d; };
  for (const o of orders) {
    const day = dayFmt.format(o.closedAt!);
    const ratio = o.subtotal > 0 ? o.total / o.subtotal : 1; // remise globale répartie au prorata
    for (const it of o.items) {
      const ttc = Math.round(it.lineTotal * ratio), tax = Math.round(it.taxAmount * ratio);
      const k = `${day}|${it.taxRateBps}|${it.taxRateName ?? ""}`;
      const e = byDayRate.get(k) ?? { ht: 0, tax: 0, ttc: 0 }; e.ttc += ttc; e.tax += tax; e.ht += ttc - tax; byDayRate.set(k, e);
    }
    // Encaissements BRUTS au jour de la vente : les remboursements sont passés à leur propre date (plus bas)
    for (const p of o.payments) { const k = `${day}|${p.method}`; const e = byDayMethod.get(k) ?? { amount: 0, count: 0, tips: 0, refunded: 0 }; e.amount += p.amount; e.count++; e.tips += p.tipAmount; byDayMethod.set(k, e); }
    const d = dayOf(day); d.ttc += o.total; d.discounts += o.discountTotal; d.tips += o.tipTotal; d.tickets++;
  }

  // Remboursements datés du jour où ils ont été faits (même pour une vente d'une période précédente), TVA au prorata de la vente
  const refunds = await prisma.refund.findMany({ where: { payment: { establishmentId }, createdAt: { gte: startOfLocalDay(fromDay, timezone), lt: endOfLocalDay(toDay, timezone) } }, orderBy: { createdAt: "asc" }, include: { payment: { select: { method: true, order: { select: { number: true, total: true, taxTotal: true, closedAt: true } } } } } });
  const refundRows = refunds.map((r) => {
    const o = r.payment.order;
    const tax = o.total > 0 ? Math.round((r.amount * o.taxTotal) / o.total) : 0;
    return { day: dayFmt.format(r.createdAt), at: r.createdAt, number: o.number, saleDay: o.closedAt ? dayFmt.format(o.closedAt) : "", method: r.payment.method, ttc: r.amount, tax, ht: r.amount - tax, reason: r.reason };
  });
  for (const r of refundRows) {
    dayOf(r.day).refunds += r.ttc;
    const k = `${r.day}|${r.method}`; const e = byDayMethod.get(k) ?? { amount: 0, count: 0, tips: 0, refunded: 0 }; e.refunded += r.ttc; byDayMethod.set(k, e);
  }

  const sales: Sheet = { name: "Ventes par taux TVA", head: ["Jour", "Taux", "Libellé TVA", "HT", "TVA", "TTC"], rows: [...byDayRate.entries()].sort().map(([k, v]) => { const [day, bps, name] = k.split("|"); return [day, `${Number(bps) / 100} %`, name, v.ht, v.tax, v.ttc]; }) };
  const receipts: Sheet = { name: "Encaissements", head: ["Jour", "Moyen", "Compte", "Encaissé", "Nombre", "Remboursé", "Net"], rows: [...byDayMethod.entries()].sort().map(([k, v]) => { const [day, m] = k.split("|"); return [day, METHOD[m] ?? m, ACCOUNTS[m]?.[0] ?? "", v.amount, v.count, v.refunded, v.amount - v.refunded]; }) };
  const days: Sheet = { name: "Journal de caisse", head: ["Jour", "Tickets", "CA TTC", "Remises", "Remboursements", "CA net"], rows: [...dayTotals.entries()].sort().map(([day, v]) => [day, v.tickets, v.ttc, v.discounts, v.refunds, v.ttc - v.refunds]) };
  const refundSheet: Sheet = { name: "Remboursements", head: ["Date", "Commande", "Vente du", "Moyen", "TTC", "dont TVA", "HT", "Motif"], rows: refundRows.map((r) => [formatDateTime(r.at, timezone), r.number, r.saleDay, METHOD[r.method] ?? r.method, r.ttc, r.tax, r.ht, r.reason]) };

  // Écritures équilibrées, par jour :
  //  ventes   : débit des comptes d'encaissement (brut) / crédit 707 HT par taux et 4457 TVA (+ écart d'arrondi en 658/758)
  //  rembours.: débit 709 (HT) et 4457 (TVA reprise) / crédit du compte d'encaissement utilisé
  const entries: Sheet = { name: "Écritures", head: ["Date", "Journal", "Compte", "Libellé", "Débit", "Crédit"], rows: [] };
  for (const [day] of [...dayTotals.entries()].sort()) {
    let debit = 0, credit = 0;
    for (const [k, v] of [...byDayMethod.entries()].filter(([k]) => k.startsWith(day + "|"))) { const m = k.split("|")[1]; const [acc, label] = ACCOUNTS[m] ?? ["471000", m]; if (v.amount) { entries.rows.push([day, "VT", acc, `${label} — ventes ${day}`, v.amount, 0]); debit += v.amount; } }
    for (const [k, v] of [...byDayRate.entries()].filter(([k]) => k.startsWith(day + "|"))) { const [, bps, name] = k.split("|"); entries.rows.push([day, "VT", `7070${String(Math.round(Number(bps) / 100)).padStart(2, "0")}`, `Ventes HT ${name || bps + " bps"} ${day}`, 0, v.ht]); credit += v.ht; if (v.tax) { entries.rows.push([day, "VT", "445710", `TVA collectée ${name || bps + " bps"} ${day}`, 0, v.tax]); credit += v.tax; } }
    if (debit !== credit) entries.rows.push(debit > credit ? [day, "VT", "758000", `Écart d'arrondi ${day}`, 0, debit - credit] : [day, "VT", "658000", `Écart d'arrondi ${day}`, credit - debit, 0]);
    for (const r of refundRows.filter((x) => x.day === day)) {
      const [acc, label] = ACCOUNTS[r.method] ?? ["471000", r.method];
      entries.rows.push([day, "VT", "709000", `Remboursement ${r.number} (HT)`, r.ht, 0]);
      if (r.tax) entries.rows.push([day, "VT", "445710", `TVA reprise remboursement ${r.number}`, r.tax, 0]);
      entries.rows.push([day, "VT", acc, `${label} — remboursement ${r.number}`, 0, r.ttc]);
    }
  }
  // Règlements des comptes clients pro (option Comptes clients) : débit banque ou caisse / crédit 411 clients
  const settlements = await prisma.accountSettlement.findMany({ where: { establishmentId, receivedAt: { gte: startOfLocalDay(fromDay, timezone), lt: endOfLocalDay(toDay, timezone) } }, orderBy: { receivedAt: "asc" }, include: { account: { select: { name: true } } } });
  for (const r of settlements) {
    const day = dayFmt.format(r.receivedAt);
    const [acc, label] = ACCOUNTS[r.method] ?? ["471000", r.method];
    entries.rows.push([day, "RG", acc, `${label} — règlement ${r.account.name}${r.reference ? ` (${r.reference})` : ""}`, r.amount, 0]);
    entries.rows.push([day, "RG", "411000", `Règlement ${r.account.name}`, 0, r.amount]);
  }
  const settlementSheet: Sheet = { name: "Règlements clients", head: ["Date", "Client", "Moyen", "Référence", "Montant"], rows: settlements.map((r) => [formatDateTime(r.receivedAt, timezone), r.account.name, METHOD[r.method] ?? r.method, r.reference ?? "", r.amount]) };

  // Cartes cadeaux vendues (option Marketing) : l'argent reçu est une avance du client (419), la vente se fait à l'utilisation
  const giftCards = await prisma.giftCard.findMany({ where: { establishmentId, createdAt: { gte: startOfLocalDay(fromDay, timezone), lt: endOfLocalDay(toDay, timezone) } }, orderBy: { createdAt: "asc" } });
  for (const g of giftCards) {
    const day = dayFmt.format(g.createdAt);
    const [acc, label] = g.saleMethod === "OFFERED" ? ["623000", "Cartes cadeaux offertes"] : ACCOUNTS[g.saleMethod] ?? ["471000", g.saleMethod];
    entries.rows.push([day, "CC", acc, `${label} — carte cadeau ${g.code}`, g.initialAmount, 0]);
    entries.rows.push([day, "CC", "419100", `Carte cadeau ${g.code}`, 0, g.initialAmount]);
  }
  const giftSheet: Sheet = { name: "Cartes cadeaux vendues", head: ["Date", "Code", "Montant", "Encaissement", "Solde restant", "Statut"], rows: giftCards.map((g) => [formatDateTime(g.createdAt, timezone), g.code, g.initialAmount, g.saleMethod === "OFFERED" ? "Offerte" : METHOD[g.saleMethod] ?? g.saleMethod, g.balance, g.status === "CANCELLED" ? "Annulée" : "Active"]) };

  // Traiteur & événements : facture finale (débit 411 client / crédit 707 HT par taux et 4457 TVA) ;
  // acomptes, soldes et remboursements (débit caisse ou banque / crédit 411, et l'inverse pour un remboursement)
  const range = { gte: startOfLocalDay(fromDay, timezone), lt: endOfLocalDay(toDay, timezone) };
  const cateringInvoices = await prisma.cateringEvent.findMany({ where: { establishmentId, invoicedAt: range }, orderBy: { invoicedAt: "asc" }, select: { invoiceNumber: true, invoicedAt: true, clientName: true, clientCompany: true, title: true, invoice: true, totalTtc: true, totalTax: true } });
  for (const ev of cateringInvoices) {
    const day = dayFmt.format(ev.invoicedAt!);
    const who = ev.clientCompany || ev.clientName;
    entries.rows.push([day, "TR", "411000", `Facture ${ev.invoiceNumber} ${who}`, ev.totalTtc, 0]);
    for (const t of ((ev.invoice as { taxes?: { rateBps: number; name: string; ht: number; tax: number }[] } | null)?.taxes ?? [])) {
      entries.rows.push([day, "TR", `7070${String(Math.round(t.rateBps / 100)).padStart(2, "0")}`, `Traiteur HT ${t.name} — ${ev.invoiceNumber}`, 0, t.ht]);
      if (t.tax) entries.rows.push([day, "TR", "445710", `TVA collectée ${t.name} — ${ev.invoiceNumber}`, 0, t.tax]);
    }
  }
  const cateringPayments = await prisma.cateringPayment.findMany({ where: { establishmentId, receivedAt: range }, orderBy: { receivedAt: "asc" }, include: { event: { select: { title: true, clientName: true, clientCompany: true } } } });
  const KIND: Record<string, string> = { DEPOSIT: "Acompte", BALANCE: "Solde", REFUND: "Remboursement" };
  for (const p of cateringPayments) {
    const day = dayFmt.format(p.receivedAt);
    const [acc, label] = ACCOUNTS[p.method] ?? ["471000", p.method];
    const who = p.event.clientCompany || p.event.clientName;
    const text = `${KIND[p.kind] ?? p.kind} ${p.event.title} (${who})${p.reference ? ` ${p.reference}` : ""}`;
    if (p.kind === "REFUND") { entries.rows.push([day, "TR", "411000", text, p.amount, 0]); entries.rows.push([day, "TR", acc, `${label} — ${text}`, 0, p.amount]); }
    else { entries.rows.push([day, "TR", acc, `${label} — ${text}`, p.amount, 0]); entries.rows.push([day, "TR", "411000", text, 0, p.amount]); }
  }
  const cateringSheet: Sheet = {
    name: "Traiteur", head: ["Date", "Pièce", "Événement", "Client", "Opération", "Moyen", "Montant"],
    rows: [
      ...cateringInvoices.map((ev) => ({ at: ev.invoicedAt!, row: [formatDateTime(ev.invoicedAt!, timezone), ev.invoiceNumber ?? "", ev.title, ev.clientCompany || ev.clientName, "Facture", "", ev.totalTtc] as (string | number)[] })),
      ...cateringPayments.map((p) => ({ at: p.receivedAt, row: [formatDateTime(p.receivedAt, timezone), p.reference ?? "", p.event.title, p.event.clientCompany || p.event.clientName, KIND[p.kind] ?? p.kind, METHOD[p.method] ?? p.method, p.kind === "REFUND" ? -p.amount : p.amount] as (string | number)[] })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime()).map((x) => x.row),
  };

  // Dépenses saisies (Comptabilité) : débit du compte de charge (HT) et de la TVA déductible (445660),
  // crédit du fournisseur (401) ; une dépense payée solde le 401 par le compte d'encaissement utilisé
  const expenses = await listExpenses(establishmentId, startOfLocalDay(fromDay, timezone), endOfLocalDay(toDay, timezone));
  for (const e of [...expenses].sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const day = dayFmt.format(e.date);
    const who = e.supplierName ?? e.supplier?.name ?? e.categoryLabel;
    const text = `${e.label}${e.reference ? ` (${e.reference})` : ""} — ${who}`;
    entries.rows.push([day, "AC", e.account, text, e.amountHt, 0]);
    if (e.taxAmount) entries.rows.push([day, "AC", "445660", `TVA déductible — ${text}`, e.taxAmount, 0]);
    entries.rows.push([day, "AC", "401000", `Fournisseur ${who}`, 0, e.amountTtc]);
    if (e.method && e.paidAt) {
      const payDay = dayFmt.format(e.paidAt);
      const [acc, label] = ACCOUNTS[e.method] ?? ["471000", e.method];
      entries.rows.push([payDay, "BQ", "401000", `Règlement ${who} — ${e.label}`, e.amountTtc, 0]);
      entries.rows.push([payDay, "BQ", acc, `${label} — ${e.label}`, 0, e.amountTtc]);
    }
  }
  const expenseSheet: Sheet = { name: "Dépenses", head: ["Date", "Libellé", "Catégorie", "Compte", "Fournisseur", "Référence", "TTC", "TVA", "HT", "Paiement"], rows: expenses.map((e) => [formatDate(e.date, timezone), e.label, e.categoryLabel, e.account, e.supplierName ?? e.supplier?.name ?? "", e.reference ?? "", e.amountTtc, e.taxAmount, e.amountHt, e.method ? METHOD[e.method] ?? e.method : "À payer"]) };

  // Achats de matières entrés en stock (réceptions de bons de commande, achats directs) : 601 / 401, au coût d'entrée (prix fournisseur, sans TVA distincte)
  const purchases = await prisma.inventoryMovement.findMany({ where: { establishmentId, kind: "PURCHASE", createdAt: range }, orderBy: { createdAt: "asc" }, include: { ingredient: { select: { name: true, unit: true } } } });
  const purchaseByDay = new Map<string, number>();
  for (const m of purchases) { const day = dayFmt.format(m.createdAt); purchaseByDay.set(day, (purchaseByDay.get(day) ?? 0) + Math.round(Math.abs(Number(m.quantity)) * (m.unitCost ?? 0))); }
  for (const [day, amount] of [...purchaseByDay.entries()].sort()) { if (!amount) continue; entries.rows.push([day, "AC", "601000", `Achats matières entrés en stock ${day}`, amount, 0]); entries.rows.push([day, "AC", "401000", `Fournisseurs — achats stock ${day}`, 0, amount]); }
  const purchaseSheet: Sheet = { name: "Achats stock", head: ["Date", "Ingrédient", "Quantité", "Unité", "Coût unit.", "Montant", "Motif"], rows: purchases.map((m) => [formatDateTime(m.createdAt, timezone), m.ingredient.name, Number(m.quantity), m.ingredient.unit, m.unitCost ?? "", Math.round(Math.abs(Number(m.quantity)) * (m.unitCost ?? 0)), m.reason ?? ""]) };

  // Compte de résultat simplifié de la période
  const sum = await getAccountingSummary(establishmentId, fromDay, toDay, timezone, { withStaff: true });
  const result: Sheet = { name: "Résultat", head: ["Poste", "Montant"], rows: [
    ["Ventes HT (net des remboursements)", sum.result.revenueHt], ["TVA collectée", sum.vat.collected], ["Achats matières (stock)", -sum.result.purchases], ["Dépenses HT saisies", -sum.result.expensesHt], ["Personnel pointé", -sum.result.laborCost],
    ["Résultat d'exploitation estimé", sum.result.result], ["Marge %", sum.result.marginPct ?? ""], ["TVA déductible (dépenses)", sum.vat.deductible], ["TVA à reverser (estimation)", sum.vat.due], ["Dépenses à payer", sum.expenses.unpaid],
  ] };

  const period = `${fromDay} → ${toDay}`;
  const header: Sheet = { name: "Entête", head: ["Champ", "Valeur"], rows: [["Établissement", est.name], ["Raison sociale", est.legalName ?? ""], ["N° Tahiti", est.tahitiNumber ?? ""], ["Période", period], ["Devise", "XPF (F CFP), sans décimales"], ["Généré le", new Date().toISOString()]] };
  return { title: `Export comptable ${period}`, sheets: [header, result, days, sales, receipts, refundSheet, ...(settlements.length ? [settlementSheet] : []), ...(giftCards.length ? [giftSheet] : []), ...(cateringSheet.rows.length ? [cateringSheet] : []), ...(expenses.length ? [expenseSheet] : []), ...(purchases.length ? [purchaseSheet] : []), entries] };
}
