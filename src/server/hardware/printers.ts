import { connect } from "node:net";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { renderReceiptEscPos } from "@/server/receipts/receipt";
import { renderKitchenTicketEscPos } from "@/server/receipts/kitchen-ticket";
import { EscPosBuilder } from "./escpos";
import type { Actor } from "@/server/services/orders";

/**
 * Phase 7 — Transport des impressions ESC/POS.
 * Pilotes :
 *  - escpos-network : socket TCP (port 9100) ouvert par le serveur — utilisable quand ManaResto tourne sur le réseau local (Mac / mini-PC).
 *  - agent          : le serveur rend le flux, le navigateur de la caisse le transmet à un agent d'impression local (HTTP, voir tools/print-agent) qui parle à l'imprimante.
 *  - browser        : impression HTML via la boîte de dialogue du navigateur (par défaut).
 */
export type PrinterConnection = { host?: string; port?: number; agentUrl?: string; timeoutMs?: number };
export type PrintJob = { printerId: string; driver: string; name: string; paperWidthMm: number; delivered: boolean; agentUrl?: string; payloadBase64?: string; error?: string };

export async function listPrinters(establishmentId: string) {
  return prisma.printer.findMany({ where: { establishmentId }, orderBy: { name: "asc" }, include: { station: { select: { id: true, name: true } } } });
}

export async function upsertPrinter(actor: Actor, input: { id?: string; name: string; kind: "RECEIPT" | "KITCHEN"; driver: "escpos-network" | "agent" | "browser"; connection?: PrinterConnection; paperWidthMm?: number; stationId?: string | null; isActive?: boolean }) {
  if (input.driver === "escpos-network" && !input.connection?.host) throw new ApiError(400, "HOST_REQUIRED", "Adresse IP de l'imprimante requise");
  if (input.driver === "agent" && !input.connection?.agentUrl) throw new ApiError(400, "AGENT_REQUIRED", "URL de l'agent d'impression requise");
  if (input.stationId && !(await prisma.kitchenStation.findFirst({ where: { id: input.stationId, establishmentId: actor.establishmentId } }))) throw new ApiError(400, "BAD_STATION", "Poste inconnu");
  const data = { name: input.name, kind: input.kind, driver: input.driver, connection: (input.connection ?? {}) as object, paperWidthMm: input.paperWidthMm ?? 80, stationId: input.stationId ?? null, isActive: input.isActive ?? true };
  if (input.id) {
    const existing = await prisma.printer.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Imprimante introuvable");
    return prisma.printer.update({ where: { id: input.id }, data });
  }
  const row = await prisma.printer.create({ data: { establishmentId: actor.establishmentId, ...data } });
  await audit({ ...actor, action: "printer.create", entityType: "printer", entityId: row.id, newValue: { name: row.name, driver: row.driver } });
  return row;
}

export async function deletePrinter(actor: Actor, id: string) {
  const existing = await prisma.printer.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Imprimante introuvable");
  await prisma.printer.delete({ where: { id } });
}

/** Envoi TCP brut (ESC/POS) vers une imprimante réseau ; résout à la fermeture du socket. */
export function sendTcp(host: string, port: number, payload: Uint8Array, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`Imprimante ${host}:${port} injoignable (délai dépassé)`)); }, timeoutMs);
    socket.once("error", (e) => { clearTimeout(timer); reject(e); });
    socket.once("connect", () => { socket.end(Buffer.from(payload), () => { clearTimeout(timer); resolve(); }); });
  });
}

/** Rend le flux d'un document et l'achemine selon le pilote de l'imprimante. */
export async function printDocument(establishmentId: string, printerId: string, doc: { kind: "receipt"; orderId: string } | { kind: "kitchen"; ticketId: string } | { kind: "test" }): Promise<PrintJob> {
  const printer = await prisma.printer.findFirst({ where: { id: printerId, establishmentId, isActive: true } });
  if (!printer) throw new ApiError(404, "NOT_FOUND", "Imprimante introuvable ou désactivée");
  const conn = (printer.connection ?? {}) as PrinterConnection;
  const payload = doc.kind === "receipt" ? await renderReceiptEscPos(establishmentId, doc.orderId) : doc.kind === "kitchen" ? await renderKitchenTicketEscPos(establishmentId, doc.ticketId) : new EscPosBuilder(printer.paperWidthMm <= 58 ? 32 : 42).align("center").bold(true).size(2, 2).line("ManaResto").size(1, 1).bold(false).line("Test d'impression").line(new Date().toLocaleString("fr-FR")).feed(3).cut().build();
  const base = { printerId: printer.id, driver: printer.driver, name: printer.name, paperWidthMm: printer.paperWidthMm };
  if (printer.driver === "escpos-network") {
    try { await sendTcp(conn.host!, conn.port ?? 9100, payload, conn.timeoutMs ?? 5000); return { ...base, delivered: true }; }
    catch (e) { return { ...base, delivered: false, error: (e as Error).message }; }
  }
  if (printer.driver === "agent") return { ...base, delivered: false, agentUrl: conn.agentUrl, payloadBase64: Buffer.from(payload).toString("base64") };
  return { ...base, delivered: false, error: "Pilote navigateur : utilisez l'impression HTML" };
}

/** Impression automatique des bons cuisine sur l'imprimante réseau du poste (appelée à l'envoi en cuisine, jamais bloquante). */
export async function autoPrintKitchenTickets(establishmentId: string, ticketIds: string[]) {
  if (ticketIds.length === 0) return;
  const printers = await prisma.printer.findMany({ where: { establishmentId, kind: "KITCHEN", isActive: true, driver: "escpos-network" } });
  if (printers.length === 0) return;
  const tickets = await prisma.kitchenTicket.findMany({ where: { id: { in: ticketIds } }, select: { id: true, stationId: true } });
  for (const t of tickets) {
    const target = printers.find((p) => p.stationId === t.stationId) ?? printers.find((p) => !p.stationId);
    if (target) printDocument(establishmentId, target.id, { kind: "kitchen", ticketId: t.id }).catch(() => {});
  }
}
