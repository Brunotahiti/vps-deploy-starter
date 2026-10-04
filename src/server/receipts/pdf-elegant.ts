import { discountLabel } from "@/lib/order-calc";
import { buildReceiptData } from "./receipt";
import { formatBps } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";

const BRAND = "#0d8a86", BRAND_DARK = "#0f6e6c", CORAL = "#f97c3c", INK = "#0f172a", MUTED = "#64748b", LINE = "#e4e9ef", SOFT = "#f1f4f8";
/** Helvetica (WinAnsi) couvre le Latin-1 (é, è, à, ç…) mais pas le macron (ā) : seuls les caractères hors plage sont translittérés. */
const strip = (ch: string) => ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const safe = (s: string) => [...s].map((ch) => (ch.charCodeAt(0) <= 0xff || ch === "€" ? ch : /^[\x20-\x7e\xa0-\xff]$/.test(strip(ch)) ? strip(ch) : "")).join("");

/**
 * Ticket / reçu PDF « élégant » au format A5 : en-tête aux couleurs de l'établissement,
 * tableau des articles, encadré des totaux, ventilation TVA, paiements. Utilisé pour le
 * téléchargement et l'envoi par e-mail (l'impression thermique reste en HTML / ESC-POS).
 */
export async function renderReceiptPdfElegant(establishmentId: string, orderId: string): Promise<Buffer> {
  const { order, est, active, totals, f, methodLabel } = await buildReceiptData(establishmentId, orderId);
  const PDFDocument = (await import("pdfkit")).default;
  const W = 420, H = 595, M = 32; // A5 portrait
  const doc = new PDFDocument({ size: [W, H], margins: { top: M, bottom: M, left: M, right: M }, info: { Title: `Reçu ${order.number}`, Author: est.name, Subject: `Reçu ${est.name}` } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const cw = W - 2 * M;
  const isPaid = order.status === "PAID";
  const money = (n: number) => safe(f(n));

  // ---- En-tête
  doc.rect(0, 0, W, 118).fill(BRAND);
  doc.rect(0, 118, W, 4).fill(CORAL);
  doc.circle(W - 40, 20, 70).fillOpacity(0.12).fill("#ffffff").fillOpacity(1);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(20).text(safe(est.name), M, 30, { width: cw * 0.62 });
  doc.font("Helvetica").fontSize(8.5).fillColor("#d3f7f2");
  const addr = [est.addressLine1, [est.postalCode, est.city].filter(Boolean).join(" "), est.phone ? `Tel. ${est.phone}` : null, est.tahitiNumber ? `N° Tahiti ${est.tahitiNumber}` : null].filter(Boolean) as string[];
  addr.forEach((l) => doc.text(safe(l), { width: cw * 0.62 }));
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(isPaid ? "REÇU" : "ADDITION", M + cw * 0.64, 32, { width: cw * 0.36, align: "right" });
  doc.font("Helvetica-Bold").fontSize(15).text(safe(`N° ${order.number}`), M + cw * 0.64, 46, { width: cw * 0.36, align: "right" });
  doc.font("Helvetica").fontSize(8.5).fillColor("#d3f7f2").text(safe(formatDateTime(order.closedAt ?? order.openedAt, est.timezone)), M + cw * 0.64, 66, { width: cw * 0.36, align: "right" });
  const meta = [order.table ? `Table ${order.table.name} · ${order.covers} couvert${order.covers > 1 ? "s" : ""}` : order.type === "TAKEAWAY" ? "A emporter" : order.type === "COUNTER" ? "Comptoir" : order.type, order.server ? `Servi par ${order.server.displayName || order.server.firstName}` : null].filter(Boolean).join("   ·   ");
  doc.text(safe(meta), M + cw * 0.64, 80, { width: cw * 0.36, align: "right" });

  // ---- Tableau des articles
  let y = 140;
  const cols = { qty: M, name: M + 30, unit: M + cw - 150, total: M + cw - 70 };
  doc.rect(M, y, cw, 20).fill(SOFT);
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7.5);
  doc.text("QTE", cols.qty + 6, y + 6, { width: 24 });
  doc.text("DESIGNATION", cols.name, y + 6, { width: 200 });
  doc.text("P.U.", cols.unit, y + 6, { width: 70, align: "right" });
  doc.text("TOTAL", cols.total, y + 6, { width: 70, align: "right" });
  y += 20;
  const items = active.filter((x) => !x.parentItemId);
  items.forEach((i, idx) => {
    const comps = active.filter((c) => c.parentItemId === i.id);
    const details = [i.modifiers.map((m) => m.name).join(", "), ...comps.map((c) => `+ ${c.name}${c.unitPrice ? ` (${f(c.unitPrice)})` : ""}`), i.notes ? `« ${i.notes} »` : "", discountLabel(i) ?? ""].filter(Boolean);
    const rowH = 18 + details.length * 10;
    if (y + rowH > H - 150) { doc.addPage(); y = M; }
    if (idx % 2 === 1) doc.rect(M, y, cw, rowH).fill("#f8fafc");
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(9).text(String(i.quantity), cols.qty + 6, y + 5, { width: 24 });
    doc.font("Helvetica").fontSize(9).text(safe(i.name), cols.name, y + 5, { width: cols.unit - cols.name - 8, lineBreak: false, ellipsis: true });
    doc.fillColor(MUTED).text(money(i.unitPrice + i.modifiersTotal), cols.unit, y + 5, { width: 70, align: "right" });
    doc.fillColor(INK).font("Helvetica-Bold").text(money(i.lineTotal + comps.reduce((a, c) => a + c.lineTotal, 0)), cols.total, y + 5, { width: 70, align: "right" });
    details.forEach((d, k) => doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(safe(d), cols.name + 6, y + 16 + k * 10, { width: cols.unit - cols.name - 14, lineBreak: false, ellipsis: true }));
    y += rowH;
  });
  doc.moveTo(M, y).lineTo(M + cw, y).lineWidth(0.5).strokeColor(LINE).stroke();
  y += 10;

  // ---- Totaux (encadré à droite) + TVA (à gauche)
  if (y > H - 170) { doc.addPage(); y = M; }
  const boxW = 170, boxX = M + cw - boxW;
  const lines: [string, string, boolean?][] = [];
  if (order.discountTotal) { lines.push(["Sous-total", money(totals.subtotal)]); lines.push([`Remise${order.discountReason ? ` (${order.discountReason})` : ""}`, `- ${money(order.discountTotal)}`]); }
  lines.push(["Total HT", money(totals.htTotal)]);
  lines.push(["TVA", money(totals.taxTotal)]);
  const boxH = Math.max(14 * lines.length + 34, 22 * totals.breakdown.length + 16);
  doc.roundedRect(boxX, y, boxW, boxH, 8).fill(SOFT);
  let ty = y + 8;
  lines.forEach(([l, v]) => { doc.fillColor(MUTED).font("Helvetica").fontSize(8.5).text(safe(l), boxX + 10, ty, { width: boxW - 20 }); doc.fillColor(INK).text(v, boxX + 10, ty, { width: boxW - 20, align: "right" }); ty += 14; });
  doc.roundedRect(boxX, ty, boxW, 26, 6).fill(BRAND_DARK);
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(9).text("TOTAL TTC", boxX + 10, ty + 8, { width: 70 });
  doc.fontSize(12).text(money(totals.total), boxX + 10, ty + 6, { width: boxW - 20, align: "right" });

  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7.5).text("VENTILATION TVA", M, y + 2);
  let vy = y + 14;
  const vatW = cw - boxW - 16;
  totals.breakdown.forEach((b) => {
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(7.5).text(safe(`${b.name} (${formatBps(b.rateBps)})`), M, vy, { width: vatW, lineBreak: false, ellipsis: true });
    doc.fillColor(MUTED).font("Helvetica").text(`HT ${money(b.ht)}   TVA ${money(b.tax)}   TTC ${money(b.ttc)}`, M, vy + 10, { width: vatW, lineBreak: false, ellipsis: true });
    vy += 22;
  });
  y += boxH + 14;

  // ---- Paiements
  const pays = order.payments.filter((p) => p.status !== "VOIDED");
  if (pays.length) {
    if (y > H - 110) { doc.addPage(); y = M; }
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(7.5).text("REGLEMENT", M, y);
    y += 12;
    pays.forEach((p) => {
      const label = [methodLabel[p.method], p.splitLabel, p.reference].filter(Boolean).join(" · ");
      doc.fillColor(INK).font("Helvetica").fontSize(8.5).text(safe(label), M, y, { width: cw - 90 });
      doc.font("Helvetica-Bold").text(money(p.amount), M, y, { width: cw, align: "right" });
      y += 12;
      const extra = [p.tipAmount ? `Pourboire ${money(p.tipAmount)}` : "", p.changeGiven ? `Reçu ${money(p.tendered ?? 0)}, rendu ${money(p.changeGiven)}` : "", p.refundedAmount ? `Rembourse ${money(p.refundedAmount)}` : ""].filter(Boolean).join(" · ");
      if (extra) { doc.fillColor(MUTED).font("Helvetica").fontSize(7.5).text(safe(extra), M + 10, y, { width: cw }); y += 10; }
    });
  }
  if (!isPaid) {
    y += 6;
    doc.roundedRect(M, y, cw, 24, 6).fill("#fff4ec");
    doc.fillColor(CORAL).font("Helvetica-Bold").fontSize(10).text(`RESTE A PAYER   ${money(order.total - order.paidTotal)}`, M, y + 7, { width: cw, align: "center" });
  }

  // ---- Pied de page
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text(isPaid ? "Merci de votre visite - Mauruuru !" : "Addition - a regler en caisse", M, H - 46, { width: cw, align: "center" });
  doc.fontSize(6.5).fillColor("#94a3b8").text(`Document genere par ManaResto - ${safe(est.name)}`, M, H - 32, { width: cw, align: "center" });
  doc.end();
  return done;
}
