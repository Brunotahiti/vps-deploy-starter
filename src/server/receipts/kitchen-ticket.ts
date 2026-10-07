import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { getKitchenTicket } from "@/server/services/kitchen";
import { formatTime } from "@/lib/dates";
import { EscPosBuilder, encodeEscPos, type PrintOp } from "@/server/hardware/escpos";

const ORDER_TYPE_LABEL: Record<string, string> = { DINE_IN: "Sur place", COUNTER: "Comptoir", TAKEAWAY: "À emporter", DELIVERY: "Livraison", ONLINE: "En ligne", KIOSK: "Borne" };

/** Bon de préparation cuisine : gros caractères, une ligne par article, options et notes. */
export async function renderKitchenTicketHtml(establishmentId: string, ticketId: string, opts: { autoPrint?: boolean } = {}) {
  const t = await getKitchenTicket(establishmentId, ticketId);
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true } });
  const esc = (s: string | null | undefined) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const live = t.items.filter((i) => i.status !== "VOIDED");
  const rows = live.map((i) => `<tr><td class="q">${i.quantity}</td><td>${i.isUrgent ? "<b>!! </b>" : ""}${esc(i.name)}${i.parentItem ? `<br><small>↳ ${esc(i.parentItem.name)}</small>` : ""}${i.modifiers.length ? `<br><small>${esc(i.modifiers.map((m) => m.name).join(", "))}</small>` : ""}${i.notes ? `<br><em>« ${esc(i.notes)} »</em>` : ""}${i.seatNumber ? `<br><small>Client ${i.seatNumber}</small>` : ""}</td></tr>`).join("");
  const where = t.order.table ? `TABLE ${esc(t.order.table.name)}` : t.order.tableLabel ? `TABLE ${esc(t.order.tableLabel)}` : ORDER_TYPE_LABEL[t.order.type].toUpperCase();
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Cuisine ${esc(t.order.number)}</title>
<style>body{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;color:#000;background:#fff;margin:0;padding:12px}.t{width:72mm;margin:0 auto}.c{text-align:center}h1{font-size:22px;margin:0}h2{font-size:18px;margin:4px 0}table{width:100%;border-collapse:collapse}td{padding:4px 0;vertical-align:top;font-size:16px;font-weight:bold}td.q{width:34px;font-size:20px}small{font-weight:normal;font-size:13px}em{font-weight:normal;color:#000}hr{border:0;border-top:2px dashed #000;margin:8px 0}.u{background:#000;color:#fff;padding:4px;font-weight:bold;text-align:center}.btn{display:block;margin:12px auto;padding:10px 16px;background:#0ea5a4;color:#fff;border:0;border-radius:8px;font-size:14px}@media print{.btn{display:none}body{padding:0}}</style></head><body><div class="t">
${t.isUrgent ? '<div class="u">URGENT · FAIRE MARCHER</div>' : ""}
<div class="c"><h1>${where}</h1><h2>${t.station ? esc(t.station.name) : "CUISINE"}${t.course ? ` · ${esc(t.course.name)}` : ""}</h2></div>
<div>n° ${esc(t.order.number)} · ${t.order.covers} couv. · ${esc(t.order.server?.displayName || t.order.server?.firstName)} · ${formatTime(t.createdAt, est.timezone)}${t.order.customerName ? `<br>Client : ${esc(t.order.customerName)}` : ""}</div>
<hr><table>${rows}</table><hr>
${t.order.notes ? `<div><em>Commande : « ${esc(t.order.notes)} »</em></div><hr>` : ""}
<div class="c"><small>${live.length} article${live.length > 1 ? "s" : ""} · ManaResto</small></div>
<button class="btn" onclick="window.print()">Imprimer</button>
</div>${opts.autoPrint ? "<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),200))</script>" : ""}</body></html>`;
}

/** Bon cuisine ESC/POS (imprimante thermique 80 mm, caractères doublés). */
export async function renderKitchenTicketEscPos(establishmentId: string, ticketId: string): Promise<Uint8Array> {
  return encodeEscPos(await renderKitchenTicketDoc(establishmentId, ticketId));
}

/** Bon cuisine sous forme de document neutre (encodé ensuite selon l'imprimante). */
export async function renderKitchenTicketDoc(establishmentId: string, ticketId: string, cols = 42): Promise<PrintOp[]> {
  const t = await getKitchenTicket(establishmentId, ticketId);
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true } });
  const b = new EscPosBuilder(cols);
  if (t.isUrgent) b.align("center").bold(true).size(2, 1).line("!! URGENT !!").size(1, 1).bold(false);
  b.align("center").bold(true).size(2, 2).line(t.order.table ? `TABLE ${t.order.table.name}` : t.order.tableLabel ? `TABLE ${t.order.tableLabel}` : ORDER_TYPE_LABEL[t.order.type].toUpperCase()).size(1, 2).line(`${t.station?.name ?? "CUISINE"}${t.course ? ` - ${t.course.name}` : ""}`).size(1, 1).bold(false);
  b.align("left").line(`n° ${t.order.number} · ${t.order.covers} couv. · ${t.order.server?.displayName || t.order.server?.firstName || ""} · ${formatTime(t.createdAt, est.timezone)}`);
  if (t.order.customerName) b.line(`Client : ${t.order.customerName}`);
  b.separator("=");
  for (const i of t.items.filter((x) => x.status !== "VOIDED")) {
    b.bold(true).size(1, 2).line(`${i.quantity} x ${i.isUrgent ? "!! " : ""}${i.name}`).size(1, 1).bold(false);
    if (i.parentItem) b.line(`   > ${i.parentItem.name}`);
    for (const m of i.modifiers) b.line(`   + ${m.name}`);
    if (i.notes) b.line(`   << ${i.notes} >>`);
    if (i.seatNumber) b.line(`   client ${i.seatNumber}`);
  }
  b.separator("=");
  if (t.order.notes) b.line(`Commande : ${t.order.notes}`);
  b.feed(3).cut();
  return b.ops();
}

/** Bon de modification ou d'annulation d'un plat déjà envoyé (l'ancienne version reste sur le premier bon). */
export async function renderKitchenChangeDoc(establishmentId: string, changeId: string, cols = 42): Promise<PrintOp[]> {
  const c = await prisma.kitchenChange.findFirst({ where: { id: changeId, establishmentId } });
  if (!c) throw new ApiError(404, "NOT_FOUND", "Modification introuvable");
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true } });
  const b = new EscPosBuilder(cols).align("center").bold(true).size(2, 2);
  b.line(c.kind === "CANCEL" ? "ANNULATION" : c.urgent ? "MODIF. URGENTE" : "MODIFICATION");
  b.size(2, 1).line(c.tableName ? `TABLE ${c.tableName}` : `n° ${c.orderNumber}`).size(1, 1).bold(false).align("left").separator("=");
  b.bold(true).size(1, 2).line(`${c.quantity} x ${c.itemName}`).size(1, 1).bold(false);
  for (const r of c.removed) b.line(`   SANS ${r}`);
  for (const a of c.added) b.line(`   + ${a}`);
  if (c.note) b.line(`   << ${c.note} >>`);
  if (c.reason) b.line(`Motif : ${c.reason}`);
  b.separator("=").line(`${c.requestedByName ? `Serveur : ${c.requestedByName} · ` : ""}${formatTime(c.createdAt, est.timezone)}`);
  b.feed(3).cut();
  return b.ops();
}

