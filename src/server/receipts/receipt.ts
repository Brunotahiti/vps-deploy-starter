import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { formatMoney, formatBps } from "@/lib/money";
import { computeOrderTotals } from "@/lib/order-calc";
import { formatDateTime } from "@/lib/dates";
import { orderInclude } from "@/server/services/orders";
import { EscPosBuilder, encodeEscPos, type PrintOp } from "@/server/hardware/escpos";

const METHOD: Record<string, string> = { CASH: "Espèces", CARD: "Carte bancaire", CHECK: "Chèque", TRANSFER: "Virement", MEAL_VOUCHER: "Ticket restaurant", COMPLIMENTARY: "Offert", OTHER: "Autre", ACCOUNT: "Sur compte (facture à suivre)" };

export async function buildReceiptData(establishmentId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, establishmentId }, include: orderInclude });
  if (!order) throw new ApiError(404, "NOT_FOUND", "Commande introuvable");
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId } });
  const active = order.items.filter((i) => i.status !== "VOIDED");
  const totals = computeOrderTotals(active.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, modifiersTotal: i.modifiersTotal, discountAmount: i.discountAmount, taxRateBps: i.taxRateBps, taxRateName: i.taxRateName })), order.discountTotal);
  const cur = est.currency;
  const f = (n: number) => formatMoney(n, cur);
  return { order, est, active, totals, f, methodLabel: METHOD };
}

/** Ticket au format HTML (impression navigateur, largeur 80 mm). */
export async function renderReceiptHtml(establishmentId: string, orderId: string, opts: { autoPrint?: boolean } = {}) {
  const { order, est, active, totals, f, methodLabel } = await buildReceiptData(establishmentId, orderId);
  const esc = (s: string | null | undefined) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const rows = active.filter((i) => !i.parentItemId).map((i) => {
    const comps = active.filter((c) => c.parentItemId === i.id);
    const total = i.lineTotal + comps.reduce((a, c) => a + c.lineTotal, 0);
    return `<tr><td>${i.quantity} ×</td><td>${esc(i.name)}${i.modifiers.length ? `<br><small>${esc(i.modifiers.map((m) => m.name).join(", "))}</small>` : ""}${comps.map((c) => `<br><small>↳ ${esc(c.name)}${c.unitPrice ? ` +${f(c.unitPrice)}` : ""}</small>`).join("")}</td><td class="r">${f(total)}</td></tr>`;
  }).join("");
  const vat = totals.breakdown.map((b) => `<tr><td>${esc(b.name)} (${formatBps(b.rateBps)})</td><td class="r">${f(b.ht)}</td><td class="r">${f(b.tax)}</td><td class="r">${f(b.ttc)}</td></tr>`).join("");
  const pays = order.payments.filter((p) => p.status !== "VOIDED").map((p) => `<tr><td>${methodLabel[p.method]}${p.splitLabel ? ` · ${esc(p.splitLabel)}` : ""}</td><td class="r">${f(p.amount)}</td></tr>${p.tipAmount ? `<tr><td><small>Pourboire</small></td><td class="r"><small>${f(p.tipAmount)}</small></td></tr>` : ""}${p.changeGiven ? `<tr><td><small>Reçu ${f(p.tendered ?? 0)} · rendu</small></td><td class="r"><small>${f(p.changeGiven)}</small></td></tr>` : ""}${p.refundedAmount ? `<tr><td><small>Remboursé</small></td><td class="r"><small>−${f(p.refundedAmount)}</small></td></tr>` : ""}`).join("");
  const isPaid = order.status === "PAID";
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${isPaid ? "Ticket" : "Addition"} ${order.number}</title>
<style>
body{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#000;background:#fff;margin:0;padding:12px}
.t{width:72mm;margin:0 auto}.c{text-align:center}.r{text-align:right;white-space:nowrap}h1{font-size:16px;margin:0}table{width:100%;border-collapse:collapse}td{padding:2px 0;vertical-align:top}
hr{border:0;border-top:1px dashed #000;margin:6px 0}.big{font-size:16px;font-weight:bold}small{color:#333}.btn{display:block;margin:12px auto;padding:10px 16px;background:#0ea5a4;color:#fff;border:0;border-radius:8px;font-size:14px}
@media print{.btn{display:none}body{padding:0}}
</style></head><body><div class="t">
<div class="c"><h1>${esc(est.name)}</h1>${est.legalName && est.legalName !== est.name ? `<div>${esc(est.legalName)}</div>` : ""}<div>${esc(est.addressLine1)}${est.addressLine1 ? "<br>" : ""}${esc([est.postalCode, est.city].filter(Boolean).join(" "))}</div>${est.phone ? `<div>Tél. ${esc(est.phone)}</div>` : ""}${est.tahitiNumber ? `<div>N° Tahiti ${esc(est.tahitiNumber)}</div>` : ""}</div>
<hr>
<table><tr><td>${isPaid ? "Ticket" : "Addition"} n°</td><td class="r">${esc(order.number)}</td></tr><tr><td>Date</td><td class="r">${formatDateTime(order.closedAt ?? order.openedAt, est.timezone)}</td></tr>${order.table ? `<tr><td>Table</td><td class="r">${esc(order.table.name)} · ${order.covers} couv.</td></tr>` : `<tr><td>Type</td><td class="r">${order.type === "TAKEAWAY" ? "À emporter" : order.type === "COUNTER" ? "Comptoir" : order.type}</td></tr>`}<tr><td>Serveur</td><td class="r">${esc(order.server?.displayName || order.server?.firstName)}</td></tr></table>
<hr><table>${rows}</table><hr>
<table>${order.discountTotal ? `<tr><td>Sous-total</td><td class="r">${f(totals.subtotal)}</td></tr><tr><td>Remise${order.discountReason ? ` (${esc(order.discountReason)})` : ""}</td><td class="r">−${f(order.discountTotal)}</td></tr>` : ""}<tr><td>Total HT</td><td class="r">${f(totals.htTotal)}</td></tr><tr><td>TVA</td><td class="r">${f(totals.taxTotal)}</td></tr><tr class="big"><td>TOTAL TTC</td><td class="r">${f(totals.total)}</td></tr></table>
<hr><table><tr><td><small>Taux</small></td><td class="r"><small>HT</small></td><td class="r"><small>TVA</small></td><td class="r"><small>TTC</small></td></tr>${vat}</table>
${pays ? `<hr><table>${pays}</table>` : ""}
${!isPaid ? `<hr><div class="c big">RESTE À PAYER ${f(order.total - order.paidTotal)}</div>` : ""}
<hr><div class="c">${isPaid ? "Merci de votre visite · Māuruuru !" : "Addition · à régler en caisse"}</div><div class="c"><small>ManaResto</small></div>
<button class="btn" onclick="window.print()">Imprimer</button>
</div>${opts.autoPrint ? "<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),200))</script>" : ""}</body></html>`;
}

/** Ticket au format PDF (pdfkit, largeur 80 mm). */
export async function renderReceiptPdf(establishmentId: string, orderId: string): Promise<Buffer> {
  const { order, est, active, totals, f, methodLabel } = await buildReceiptData(establishmentId, orderId);
  const PDFDocument = (await import("pdfkit")).default;
  const width = 226; // 80 mm en points
  const doc = new PDFDocument({ size: [width, 800], margins: { top: 14, bottom: 14, left: 12, right: 12 }, info: { Title: `Ticket ${order.number}`, Author: est.name } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const w = width - 24;
  const row = (l: string, r: string, opts: { bold?: boolean; size?: number } = {}) => {
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size ?? 8);
    const y = doc.y;
    doc.text(l, 12, y, { width: w * 0.68, continued: false });
    const yAfter = doc.y;
    doc.text(r, 12 + w * 0.6, y, { width: w * 0.4, align: "right" });
    doc.y = Math.max(yAfter, doc.y);
  };
  const hr = () => { doc.moveDown(0.3); doc.moveTo(12, doc.y).lineTo(12 + w, doc.y).dash(2, { space: 2 }).stroke().undash(); doc.moveDown(0.4); };
  doc.font("Helvetica-Bold").fontSize(12).text(est.name, { align: "center" });
  doc.font("Helvetica").fontSize(8);
  if (est.addressLine1) doc.text(est.addressLine1, { align: "center" });
  const cityLine = [est.postalCode, est.city].filter(Boolean).join(" ");
  if (cityLine) doc.text(cityLine, { align: "center" });
  if (est.phone) doc.text(`Tél. ${est.phone}`, { align: "center" });
  if (est.tahitiNumber) doc.text(`N° Tahiti ${est.tahitiNumber}`, { align: "center" });
  hr();
  row(order.status === "PAID" ? "Ticket n°" : "Addition n°", order.number);
  row("Date", formatDateTime(order.closedAt ?? order.openedAt, est.timezone));
  if (order.table) row("Table", `${order.table.name} · ${order.covers} couv.`);
  row("Serveur", order.server?.displayName || order.server?.firstName || "");
  hr();
  for (const i of active.filter((x) => !x.parentItemId)) {
    const comps = active.filter((c) => c.parentItemId === i.id);
    row(`${i.quantity} × ${i.name}`, f(i.lineTotal + comps.reduce((a, c) => a + c.lineTotal, 0)));
    if (i.modifiers.length) doc.fontSize(7).fillColor("#444").text("   " + i.modifiers.map((m) => m.name).join(", ")).fillColor("#000");
    for (const c of comps) doc.fontSize(7).fillColor("#444").text(`   ↳ ${c.name}${c.unitPrice ? ` +${f(c.unitPrice)}` : ""}`).fillColor("#000");
  }
  hr();
  if (order.discountTotal) { row("Sous-total", f(totals.subtotal)); row(`Remise${order.discountReason ? ` (${order.discountReason})` : ""}`, `−${f(order.discountTotal)}`); }
  row("Total HT", f(totals.htTotal));
  row("TVA", f(totals.taxTotal));
  row("TOTAL TTC", f(totals.total), { bold: true, size: 11 });
  hr();
  doc.fontSize(7);
  for (const b of totals.breakdown) row(`${b.name} (${formatBps(b.rateBps)})`, `HT ${f(b.ht)} · TVA ${f(b.tax)} · TTC ${f(b.ttc)}`);
  const pays = order.payments.filter((p) => p.status !== "VOIDED");
  if (pays.length) { hr(); for (const p of pays) { row(`${methodLabel[p.method]}${p.splitLabel ? ` · ${p.splitLabel}` : ""}`, f(p.amount)); if (p.tipAmount) row("  Pourboire", f(p.tipAmount)); if (p.changeGiven) row(`  Reçu ${f(p.tendered ?? 0)} · rendu`, f(p.changeGiven)); } }
  if (order.status !== "PAID") { hr(); row("RESTE À PAYER", f(order.total - order.paidTotal), { bold: true, size: 10 }); }
  hr();
  doc.fontSize(8).text(order.status === "PAID" ? "Merci de votre visite · Māuruuru !" : "Addition · à régler en caisse", { align: "center" });
  doc.fontSize(6).fillColor("#666").text("ManaResto", { align: "center" });
  doc.end();
  return done;
}

/** Ticket au format ESC/POS (octets), prêt pour un transport imprimante. */
export async function renderReceiptEscPos(establishmentId: string, orderId: string): Promise<Uint8Array> {
  return encodeEscPos(await renderReceiptDoc(establishmentId, orderId));
}

/**
 * Ticket thermique sous forme de document neutre (encodé ensuite selon l'imprimante).
 * Le tiroir-caisse n'est pas ouvert ici : il l'est à l'encaissement, jamais à la réimpression d'un ticket.
 */
export async function renderReceiptDoc(establishmentId: string, orderId: string, cols = 42): Promise<PrintOp[]> {
  const { order, est, active, totals, f, methodLabel } = await buildReceiptData(establishmentId, orderId);
  const b = new EscPosBuilder(cols);
  b.align("center").bold(true).size(2, 2).line(est.name).size(1, 1).bold(false);
  if (est.addressLine1) b.line(est.addressLine1);
  if (est.city) b.line([est.postalCode, est.city].filter(Boolean).join(" "));
  if (est.tahitiNumber) b.line(`N Tahiti ${est.tahitiNumber}`);
  b.align("left").separator();
  b.row(order.status === "PAID" ? "Ticket" : "Addition", order.number);
  b.row("Date", formatDateTime(order.closedAt ?? order.openedAt, est.timezone));
  if (order.table) b.row("Table", `${order.table.name} (${order.covers})`);
  b.separator();
  for (const i of active.filter((x) => !x.parentItemId)) {
    const comps = active.filter((c) => c.parentItemId === i.id);
    b.row(`${i.quantity} x ${i.name}`, f(i.lineTotal + comps.reduce((a, c) => a + c.lineTotal, 0)));
    if (i.modifiers.length) b.line("   " + i.modifiers.map((m) => m.name).join(", "));
    for (const c of comps) b.line(`   > ${c.name}`);
  }
  b.separator();
  if (order.discountTotal) b.row("Remise", `-${f(order.discountTotal)}`);
  b.row("Total HT", f(totals.htTotal));
  b.row("TVA", f(totals.taxTotal));
  b.bold(true).size(1, 2).row("TOTAL TTC", f(totals.total)).size(1, 1).bold(false);
  for (const t of totals.breakdown) b.row(`TVA ${formatBps(t.rateBps)}`, `${f(t.ht)} / ${f(t.tax)}`);
  const pays = order.payments.filter((p) => p.status !== "VOIDED");
  if (pays.length) { b.separator(); for (const p of pays) b.row(methodLabel[p.method], f(p.amount)); }
  b.separator().align("center").line(order.status === "PAID" ? "Mauruuru !" : "A regler en caisse").feed(3).cut();
  return b.ops();
}
