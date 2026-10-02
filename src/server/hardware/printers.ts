import { connect } from "node:net";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { isPrivateIpv4 } from "@/server/net/lan";
import { audit } from "@/server/audit";
import { randomToken, sha256 } from "@/server/auth/password";
import { renderReceiptDoc } from "@/server/receipts/receipt";
import { renderKitchenChangeDoc, renderKitchenTicketDoc } from "@/server/receipts/kitchen-ticket";
import { EscPosBuilder, encodeEscPos, type PrintOp } from "./escpos";
import type { Actor } from "@/server/services/orders";
import type { Printer, PaymentMethod } from "@/generated/prisma/client";

/**
 * Transport des impressions et du tiroir-caisse.
 * Pilotes :
 *  - cloud-epson / cloud-star : imprimante connectée (Epson Server Direct Print, Star CloudPRNT) qui vient
 *    chercher ses travaux sur ManaResto toutes les quelques secondes. Fonctionne avec le serveur hébergé.
 *  - escpos-network : socket TCP (port 9100) ouvert par le serveur — seulement quand ManaResto tourne sur le réseau du restaurant.
 *  - agent          : le serveur rend le flux, le navigateur de la caisse le transmet à un agent d'impression local (tools/print-agent).
 *  - browser        : impression HTML via la boîte de dialogue du navigateur (pas de tiroir possible).
 * Le tiroir-caisse se branche sur une imprimante de caisse (prise RJ11) : l'ouvrir, c'est envoyer une impulsion à cette imprimante.
 */
export const PRINTER_DRIVERS = ["cloud-epson", "cloud-star", "escpos-network", "agent", "browser"] as const;
export type PrinterDriver = (typeof PRINTER_DRIVERS)[number];
export const isCloudDriver = (d: string) => d === "cloud-epson" || d === "cloud-star";

export type PrinterConnection = { host?: string; port?: number; agentUrl?: string; timeoutMs?: number };
export type PrintJob = { printerId: string; driver: string; name: string; paperWidthMm: number; delivered: boolean; queued?: boolean; jobId?: string; warning?: string; agentUrl?: string; payloadBase64?: string; error?: string };
export type PrintDoc = { kind: "receipt"; orderId: string } | { kind: "kitchen"; ticketId: string } | { kind: "change"; changeId: string } | { kind: "test" } | { kind: "drawer" };

/** Au-delà, une imprimante connectée qui ne s'est pas manifestée est considérée hors ligne. */
export const CLOUD_OFFLINE_MS = 2 * 60_000;

const printerView = { id: true, name: true, kind: true, driver: true, connection: true, paperWidthMm: true, isActive: true, hasDrawer: true, drawerPin: true, stationId: true, terminalId: true, lastSeenAt: true, lastStatus: true, cloudTokenHash: true, station: { select: { id: true, name: true } }, terminal: { select: { id: true, name: true } } } as const;

export async function listPrinters(establishmentId: string) {
  const rows = await prisma.printer.findMany({ where: { establishmentId }, orderBy: { name: "asc" }, select: printerView });
  // Le jeton d'interrogation n'est jamais renvoyé : seulement le fait qu'il existe
  return rows.map(({ cloudTokenHash, ...p }) => ({ ...p, hasCloudUrl: !!cloudTokenHash }));
}

const LAN_PORTS = [9100, 9101, 9102, 515];
/**
 * Impression réseau directe (pilote « escpos-network ») : seulement depuis le boîtier de secours ou une installation
 * dans le restaurant (LAN_PRINTING=1), jamais depuis le serveur en ligne, qui n'ouvre aucune connexion vers une adresse saisie.
 */
export const lanPrintingEnabled = () => process.env.BOX_MODE === "1" || process.env.LAN_PRINTING === "1" || process.env.NODE_ENV === "test";
/** Imprimante du réseau du restaurant, sur un port d'impression (tests : imprimante simulée sur la machine). */
export function assertLanPrinter(host?: string, port?: number) {
  if (process.env.NODE_ENV === "test") return;
  if (!host || !isPrivateIpv4(host)) throw new ApiError(400, "BAD_PRINTER_HOST", "Adresse IP de l'imprimante sur le réseau du restaurant attendue (ex. 192.168.1.50)");
  if (!LAN_PORTS.includes(port ?? 9100)) throw new ApiError(400, "BAD_PRINTER_PORT", "Port d'imprimante attendu : 9100 (ou 9101, 9102, 515)");
}

/** Adresse à saisir dans la configuration de l'imprimante connectée (montrée une seule fois). */
export function cloudUrl(base: string, token: string) {
  return `${base.replace(/\/$/, "")}/api/hardware/cloud/${token}`;
}

export type PrinterInput = { id?: string; name: string; kind: "RECEIPT" | "KITCHEN"; driver: PrinterDriver; connection?: PrinterConnection; paperWidthMm?: number; stationId?: string | null; terminalId?: string | null; hasDrawer?: boolean; drawerPin?: 2 | 5; isActive?: boolean };

/** Crée ou modifie une imprimante. Pour une imprimante connectée, renvoie un nouveau jeton à la création (ou au passage en mode connecté). */
export async function upsertPrinter(actor: Actor, input: PrinterInput): Promise<Printer & { cloudToken?: string }> {
  if (input.driver === "escpos-network" && !input.connection?.host) throw new ApiError(400, "HOST_REQUIRED", "Adresse IP de l'imprimante requise");
  if (input.driver === "escpos-network") assertLanPrinter(input.connection?.host, input.connection?.port);
  if (input.driver === "agent" && !input.connection?.agentUrl) throw new ApiError(400, "AGENT_REQUIRED", "URL de l'agent d'impression requise");
  if (input.hasDrawer && input.driver === "browser") throw new ApiError(400, "DRAWER_UNSUPPORTED", "Le tiroir-caisse s'ouvre par l'imprimante : choisissez une imprimante connectée, réseau ou un agent local");
  if (input.stationId && !(await prisma.kitchenStation.findFirst({ where: { id: input.stationId, establishmentId: actor.establishmentId } }))) throw new ApiError(400, "BAD_STATION", "Poste inconnu");
  if (input.terminalId && !(await prisma.terminal.findFirst({ where: { id: input.terminalId, establishmentId: actor.establishmentId } }))) throw new ApiError(400, "BAD_TERMINAL", "Caisse inconnue");
  const existing = input.id ? await prisma.printer.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } }) : null;
  if (input.id && !existing) throw new ApiError(404, "NOT_FOUND", "Imprimante introuvable");
  const cloud = isCloudDriver(input.driver);
  const token = cloud && !existing?.cloudTokenHash ? randomToken(24) : undefined;
  const data = {
    name: input.name, kind: input.kind, driver: input.driver, connection: (cloud ? {} : input.connection ?? {}) as object,
    paperWidthMm: input.paperWidthMm ?? existing?.paperWidthMm ?? 80, stationId: input.stationId ?? null, terminalId: input.terminalId ?? null,
    hasDrawer: input.hasDrawer ?? existing?.hasDrawer ?? false, drawerPin: input.drawerPin ?? existing?.drawerPin ?? 2,
    isActive: input.isActive ?? existing?.isActive ?? true,
    ...(token ? { cloudTokenHash: sha256(token) } : cloud ? {} : { cloudTokenHash: null, lastSeenAt: null, lastStatus: null }),
  };
  if (existing) {
    const row = await prisma.printer.update({ where: { id: existing.id }, data });
    return { ...row, cloudToken: token };
  }
  const row = await prisma.printer.create({ data: { establishmentId: actor.establishmentId, ...data } });
  await audit({ ...actor, action: "printer.create", entityType: "printer", entityId: row.id, newValue: { name: row.name, driver: row.driver, hasDrawer: row.hasDrawer } });
  return { ...row, cloudToken: token };
}

/** Réponse d'enregistrement : jamais l'empreinte du jeton ; l'adresse complète seulement quand un jeton vient d'être créé. */
export function savedPrinterView(row: Printer & { cloudToken?: string }, base: string) {
  const { cloudTokenHash, cloudToken, ...p } = row;
  return { ...p, hasCloudUrl: !!cloudTokenHash, cloudUrl: cloudToken ? cloudUrl(base, cloudToken) : undefined };
}

/** Nouvelle adresse pour une imprimante connectée (l'ancienne cesse aussitôt de fonctionner). */
export async function regenerateCloudToken(actor: Actor, id: string) {
  const p = await prisma.printer.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!p) throw new ApiError(404, "NOT_FOUND", "Imprimante introuvable");
  if (!isCloudDriver(p.driver)) throw new ApiError(400, "NOT_CLOUD", "Cette imprimante n'est pas une imprimante connectée");
  const token = randomToken(24);
  await prisma.printer.update({ where: { id }, data: { cloudTokenHash: sha256(token), lastSeenAt: null, lastStatus: null } });
  await audit({ ...actor, action: "printer.token", entityType: "printer", entityId: id });
  return token;
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

async function renderDoc(establishmentId: string, printer: Printer, doc: PrintDoc): Promise<PrintOp[]> {
  const cols = printer.paperWidthMm <= 58 ? 32 : 42;
  if (doc.kind === "receipt") return renderReceiptDoc(establishmentId, doc.orderId, cols);
  if (doc.kind === "kitchen") return renderKitchenTicketDoc(establishmentId, doc.ticketId, cols);
  if (doc.kind === "change") return renderKitchenChangeDoc(establishmentId, doc.changeId, cols);
  if (doc.kind === "drawer") return new EscPosBuilder(cols).drawer(printer.drawerPin === 5 ? 5 : 2).ops();
  const b = new EscPosBuilder(cols).align("center").bold(true).size(2, 2).line("ManaResto").size(1, 1).bold(false).line("Test d'impression").line(new Date().toLocaleString("fr-FR"));
  if (printer.hasDrawer) b.line("Le tiroir-caisse doit s'ouvrir");
  b.feed(3).cut();
  if (printer.hasDrawer) b.drawer(printer.drawerPin === 5 ? 5 : 2);
  return b.ops();
}

/** Achemine un document selon le pilote : TCP, relais par l'agent local, ou file d'attente de l'imprimante connectée. */
async function dispatch(establishmentId: string, printer: Printer, kind: PrintDoc["kind"], ops: PrintOp[]): Promise<PrintJob> {
  const base = { printerId: printer.id, driver: printer.driver, name: printer.name, paperWidthMm: printer.paperWidthMm };
  const conn = (printer.connection ?? {}) as PrinterConnection;
  if (isCloudDriver(printer.driver)) {
    const job = await prisma.printJob.create({ data: { establishmentId, printerId: printer.id, kind, document: ops as object[] } });
    const offline = !printer.lastSeenAt || Date.now() - printer.lastSeenAt.getTime() > CLOUD_OFFLINE_MS;
    return { ...base, delivered: false, queued: true, jobId: job.id, warning: offline ? (printer.lastSeenAt ? "L'imprimante ne s'est pas manifestée depuis plusieurs minutes : le ticket partira dès qu'elle sera en ligne" : "L'imprimante ne s'est encore jamais connectée : vérifiez l'adresse saisie dans sa configuration") : undefined };
  }
  if (printer.driver === "escpos-network") {
    if (!lanPrintingEnabled()) return { ...base, delivered: false, error: "Imprimante réseau directe : elle imprime par le boîtier de secours du restaurant. Avec la version en ligne, choisissez une imprimante connectée ou l'agent d'impression." };
    try {
      assertLanPrinter(conn.host, conn.port);
      await sendTcp(conn.host!, conn.port ?? 9100, encodeEscPos(ops), conn.timeoutMs ?? 5000);
      return { ...base, delivered: true };
    } catch {
      return { ...base, delivered: false, error: "Imprimante injoignable : vérifiez qu'elle est allumée et branchée sur le réseau du restaurant" };
    }
  }
  if (printer.driver === "agent") return { ...base, delivered: false, agentUrl: conn.agentUrl, payloadBase64: Buffer.from(encodeEscPos(ops)).toString("base64") };
  return { ...base, delivered: false, error: "Pilote navigateur : utilisez l'impression HTML" };
}

/** Rend le document et l'achemine vers l'imprimante choisie. */
export async function printDocument(establishmentId: string, printerId: string, doc: PrintDoc): Promise<PrintJob> {
  const printer = await prisma.printer.findFirst({ where: { id: printerId, establishmentId, isActive: true } });
  if (!printer) throw new ApiError(404, "NOT_FOUND", "Imprimante introuvable ou désactivée");
  if (doc.kind === "drawer" && !printer.hasDrawer) throw new ApiError(400, "NO_DRAWER", "Aucun tiroir-caisse sur cette imprimante");
  return dispatch(establishmentId, printer, doc.kind, await renderDoc(establishmentId, printer, doc));
}

/** Imprimante portant le tiroir de la caisse : celle associée au terminal, sinon une imprimante de caisse non attribuée, sinon la première. */
export async function findDrawerPrinter(establishmentId: string, terminalId?: string | null) {
  const printers = await prisma.printer.findMany({ where: { establishmentId, isActive: true, hasDrawer: true, driver: { not: "browser" } }, orderBy: { name: "asc" } });
  return (terminalId ? printers.find((p) => p.terminalId === terminalId) : undefined) ?? printers.find((p) => !p.terminalId) ?? printers[0] ?? null;
}

/** Ouvre le tiroir-caisse (bouton « Ouvrir le tiroir », encaissement, ouverture ou clôture de caisse) et le trace dans le journal d'audit. */
export async function openDrawer(actor: Actor, opts: { reason?: string | null; trigger: "manual" | "payment" | "cash_open" | "cash_close" }): Promise<PrintJob> {
  const printer = await findDrawerPrinter(actor.establishmentId, actor.terminalId);
  if (!printer) throw new ApiError(404, "NO_DRAWER", "Aucun tiroir-caisse configuré : ajoutez-le dans Administration → Imprimantes & tiroir");
  const result = await dispatch(actor.establishmentId, printer, "drawer", await renderDoc(actor.establishmentId, printer, { kind: "drawer" }));
  await audit({ ...actor, action: "drawer.open", entityType: "printer", entityId: printer.id, newValue: { trigger: opts.trigger, reason: opts.reason ?? null, printer: printer.name } });
  return result;
}

/** Après un encaissement : ouvre le tiroir si un moyen de paiement utilisé le demande (espèces par défaut). Jamais bloquant. */
export async function openDrawerAfterPayment(actor: Actor, methods: PaymentMethod[]) {
  if (methods.length === 0) return null;
  const opens = await prisma.paymentMethodConfig.count({ where: { establishmentId: actor.establishmentId, method: { in: methods }, opensDrawer: true } });
  if (!opens || !(await findDrawerPrinter(actor.establishmentId, actor.terminalId))) return null;
  return openDrawer(actor, { trigger: "payment" }).catch(() => null);
}

/** Ouverture et clôture de caisse : ouvre le tiroir s'il est configuré. Jamais bloquant. */
export async function openDrawerIfConfigured(actor: Actor, trigger: "cash_open" | "cash_close") {
  if (!(await findDrawerPrinter(actor.establishmentId, actor.terminalId))) return null;
  return openDrawer(actor, { trigger }).catch(() => null);
}

/** Impression automatique des bons cuisine sur l'imprimante du poste (appelée à l'envoi en cuisine, jamais bloquante). */
export async function autoPrintKitchenTickets(establishmentId: string, ticketIds: string[]) {
  if (ticketIds.length === 0) return;
  const printers = await prisma.printer.findMany({ where: { establishmentId, kind: "KITCHEN", isActive: true, driver: { in: ["escpos-network", "cloud-epson", "cloud-star"] } } });
  if (printers.length === 0) return;
  const tickets = await prisma.kitchenTicket.findMany({ where: { id: { in: ticketIds } }, select: { id: true, stationId: true } });
  for (const t of tickets) {
    const target = printers.find((p) => p.stationId === t.stationId) ?? printers.find((p) => !p.stationId);
    if (target) printDocument(establishmentId, target.id, { kind: "kitchen", ticketId: t.id }).catch(() => {});
  }
}

/** Bon « MODIFICATION » ou « ANNULATION » sur l'imprimante du poste du plat, comme les bons cuisine. */
export async function autoPrintKitchenChange(establishmentId: string, changeId: string) {
  const printers = await prisma.printer.findMany({ where: { establishmentId, kind: "KITCHEN", isActive: true, driver: { in: ["escpos-network", "cloud-epson", "cloud-star"] } } });
  if (printers.length === 0) return;
  const c = await prisma.kitchenChange.findUnique({ where: { id: changeId }, select: { stationId: true } });
  const target = printers.find((p) => p.stationId === c?.stationId) ?? printers.find((p) => !p.stationId);
  if (target) await printDocument(establishmentId, target.id, { kind: "change", changeId });
}

