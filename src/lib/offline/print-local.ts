/**
 * Impression sans internet, depuis la tablette : les documents sont construits ici (mêmes tickets que le serveur)
 * puis envoyés directement à l'imprimante du restaurant par le réseau local, via l'agent d'impression
 * (tools/print-agent), ou imprimés par le navigateur. Une imprimante pilotée par le serveur (réseau, connectée)
 * n'est pas joignable sans internet depuis une tablette.
 */
import { EscPosBuilder, encodeEscPos, type PrintOp } from "@/lib/escpos";
import { computeOrderTotals } from "@/lib/order-calc";
import { formatBps, formatMoney } from "@/lib/money";
import { formatDateTime, formatTime } from "@/lib/dates";

export type LocalPrinter = { id: string; name: string; kind: "RECEIPT" | "KITCHEN"; driver: string; agentUrl: string | null; paperWidthMm: number; stationId: string | null; terminalId: string | null; hasDrawer: boolean; drawerPin: number };
type Est = { name: string; addressLine1?: string | null; city?: string | null; postalCode?: string | null; tahitiNumber?: string | null; timezone?: string; currency?: string };
type Mod = { name: string };
type Item = { id: string; name: string; quantity: number; unitPrice: number; modifiersTotal: number; discountAmount: number; lineTotal: number; taxRateBps: number; taxRateName: string | null; status: string; parentItemId: string | null; courseId: string | null; kitchenStationId: string | null; notes: string | null; seatNumber: number | null; isUrgent: boolean; modifiers: Mod[] };
type Pay = { method: string; amount: number; status: string };
export type LocalOrder = {
  number: string; type: string; status: string; covers: number; discountTotal: number; total: number; paidTotal: number; customerName: string | null; notes: string | null;
  openedAt: Date | string; closedAt: Date | string | null; table: { name: string } | null; server: { firstName: string; displayName: string | null } | null;
  items: Item[]; payments: Pay[]; courses: { id: string; name: string }[];
};

const METHOD: Record<string, string> = { CASH: "Especes", CARD: "Carte bancaire", CHECK: "Cheque", TRANSFER: "Virement", MEAL_VOUCHER: "Ticket restaurant", COMPLIMENTARY: "Offert", OTHER: "Autre" };
const TYPE: Record<string, string> = { DINE_IN: "Sur place", COUNTER: "Comptoir", TAKEAWAY: "A emporter", DELIVERY: "Livraison", ONLINE: "En ligne", KIOSK: "Borne" };
export const colsFor = (paperWidthMm: number) => (paperWidthMm <= 58 ? 32 : 42);
// Numéro provisoire d'une commande créée hors ligne : « HORS-LIGNE »
const shortNumber = (n: string) => (n.includes("-") && !n.startsWith("HORS") ? n.split("-").pop()! : n);

/** Ticket client (même contenu que le ticket thermique du serveur). */
export function receiptOps(order: LocalOrder, est: Est, cols = 42): PrintOp[] {
  const cur = est.currency ?? "XPF";
  const f = (n: number) => formatMoney(n, cur);
  const active = order.items.filter((i) => i.status !== "VOIDED");
  const totals = computeOrderTotals(active.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, modifiersTotal: i.modifiersTotal, discountAmount: i.discountAmount, taxRateBps: i.taxRateBps, taxRateName: i.taxRateName })), order.discountTotal);
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
  if (pays.length) { b.separator(); for (const p of pays) b.row(METHOD[p.method] ?? p.method, f(p.amount)); }
  if (order.status !== "PAID" && order.total > order.paidTotal) b.bold(true).row("RESTE A PAYER", f(order.total - order.paidTotal)).bold(false);
  b.separator().align("center").line(order.status === "PAID" ? "Mauruuru !" : "A regler en caisse").feed(3).cut();
  return b.ops();
}

/**
 * Bons cuisine des articles qui viennent d'être envoyés : un bon par (suite, poste), comme le serveur.
 * Retourne pour chaque bon le poste concerné, pour choisir l'imprimante.
 */
export function kitchenTickets(order: LocalOrder, sentItemIds: string[], stations: { id: string; name: string }[], timezone?: string, cols = 42) {
  const sent = order.items.filter((i) => sentItemIds.includes(i.id) && i.status !== "VOIDED");
  const groups = new Map<string, Item[]>();
  for (const i of sent) {
    if (!i.kitchenStationId && sent.some((c) => c.parentItemId === i.id)) continue; // parent de formule : ses composants partent en cuisine
    const key = `${i.courseId ?? "none"}|${i.kitchenStationId ?? "none"}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  return [...groups.entries()].map(([key, items]) => {
    const [courseId, stationId] = key.split("|");
    const station = stations.find((s) => s.id === stationId) ?? null;
    const course = order.courses.find((c) => c.id === courseId) ?? null;
    const b = new EscPosBuilder(cols);
    if (items.some((i) => i.isUrgent)) b.align("center").bold(true).size(2, 1).line("!! URGENT !!").size(1, 1).bold(false);
    b.align("center").bold(true).size(2, 2).line(order.table ? `TABLE ${order.table.name}` : (TYPE[order.type] ?? order.type).toUpperCase()).size(1, 2).line(`${station?.name ?? "CUISINE"}${course ? ` - ${course.name}` : ""}`).size(1, 1).bold(false);
    b.align("left").line(`n° ${shortNumber(order.number)} · ${order.covers} couv. · ${order.server?.displayName || order.server?.firstName || ""} · ${formatTime(new Date(), timezone)}`);
    b.line("(envoye sans internet)");
    if (order.customerName) b.line(`Client : ${order.customerName}`);
    b.separator("=");
    for (const i of items) {
      b.bold(true).size(1, 2).line(`${i.quantity} x ${i.isUrgent ? "!! " : ""}${i.name}`).size(1, 1).bold(false);
      const parent = i.parentItemId ? order.items.find((p) => p.id === i.parentItemId) : null;
      if (parent) b.line(`   > ${parent.name}`);
      for (const m of i.modifiers) b.line(`   + ${m.name}`);
      if (i.notes) b.line(`   << ${i.notes} >>`);
      if (i.seatNumber) b.line(`   client ${i.seatNumber}`);
    }
    b.separator("=");
    if (order.notes) b.line(`Commande : ${order.notes}`);
    b.feed(3).cut();
    return { stationId: stationId === "none" ? null : stationId, ops: b.ops() };
  });
}

const toBase64 = (bytes: Uint8Array) => { let s = ""; for (const x of bytes) s += String.fromCharCode(x); return btoa(s); };

/** Envoie un document à l'agent d'impression du réseau local. */
export async function sendToAgent(agentUrl: string, ops: PrintOp[]) {
  const res = await fetch(agentUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payloadBase64: toBase64(encodeEscPos(ops)) }), signal: AbortSignal.timeout?.(8000) });
  if (!res.ok) throw new Error(`Agent d'impression : ${res.status}`);
}

/** Impression par le navigateur (pilote « navigateur », ou dernier recours) : ticket texte dans un cadre invisible. */
export function printInBrowser(ops: PrintOp[], title = "Ticket") {
  const text = ops.filter((o): o is Extract<PrintOp, { t: "text" }> => o.t === "text").map((o) => o.s).join("");
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentWindow!.document;
  doc.open();
  doc.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{margin:0;padding:8px;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;width:72mm}</style></head><body>${esc(text)}</body></html>`);
  doc.close();
  setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 2000); }, 150);
}

/** Imprimante de ticket pour cette caisse : celle du terminal d'abord, sinon une imprimante commune. */
export function pickReceiptPrinter(printers: LocalPrinter[], terminalId: string | null | undefined) {
  return printers.filter((p) => p.kind === "RECEIPT" && (!p.terminalId || p.terminalId === terminalId)).sort((a, b) => Number(b.terminalId === terminalId) - Number(a.terminalId === terminalId))[0] ?? null;
}

/** Imprime sur une imprimante joignable sans internet. Retourne le moyen utilisé, ou null si elle ne l'est pas. */
export async function printLocal(printer: LocalPrinter | null, ops: PrintOp[], title: string): Promise<"agent" | "browser" | null> {
  if (printer?.driver === "agent" && printer.agentUrl) { await sendToAgent(printer.agentUrl, ops); return "agent"; }
  if (!printer || printer.driver === "browser") { printInBrowser(ops, title); return "browser"; }
  return null; // imprimante pilotée par le serveur : injoignable sans internet
}

/** Ouverture du tiroir-caisse par l'agent local (encaissement en espèces sans internet). */
export async function openDrawerLocal(printers: LocalPrinter[], terminalId: string | null | undefined) {
  const p = printers.filter((x) => x.hasDrawer && x.driver === "agent" && x.agentUrl && (!x.terminalId || x.terminalId === terminalId)).sort((a, b) => Number(b.terminalId === terminalId) - Number(a.terminalId === terminalId))[0];
  if (!p) return false;
  await sendToAgent(p.agentUrl!, [{ t: "drawer", pin: p.drawerPin === 5 ? 5 : 2 }]);
  return true;
}
