import { prisma, type Tx } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { startOfLocalDay, localDay } from "@/lib/dates";
import type { Actor } from "./orders";
import { serviceSettings, onTicketReady, onTicketNotReady } from "./service-tracking";
import { syncTakeawayReady } from "./takeaway";
import { notifyDishReady } from "@/server/push";
import type { KitchenTicketStatus, Prisma } from "@/generated/prisma/client";

/**
 * Phase 3 — Écran cuisine (KDS).
 * Un ticket cuisine = les articles d'un service envoyés vers un poste (CUISINE, BAR, PIZZA…).
 * Cycle : NEW → ACCEPTED → IN_PROGRESS → READY → DONE (rappel possible DONE → READY).
 * Les statuts sont répercutés sur les articles (SENT / PREPARING / READY / SERVED),
 * sur le service (READY / SERVED) et diffusés en temps réel vers la salle.
 */
export const ACTIVE_TICKET_STATUSES: KitchenTicketStatus[] = ["NEW", "ACCEPTED", "IN_PROGRESS", "READY"];
const ACTION_STATUSES: KitchenTicketStatus[] = ["ACCEPTED", "IN_PROGRESS", "READY", "DONE"];

export const ticketInclude = {
  station: { select: { id: true, name: true, color: true, warnAfterSec: true, alertAfterSec: true } },
  course: { select: { id: true, name: true, sortOrder: true, status: true } },
  order: {
    select: {
      id: true, number: true, type: true, covers: true, customerName: true, tableLabel: true, notes: true, status: true, openedAt: true, serverId: true,
      table: { select: { id: true, name: true } },
      server: { select: { id: true, firstName: true, displayName: true } },
    },
  },
  items: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    select: {
      id: true, name: true, quantity: true, seatNumber: true, notes: true, isUrgent: true, status: true, readyAt: true, parentItemId: true,
      modifiers: { select: { name: true, groupName: true } },
      parentItem: { select: { name: true } },
    },
  },
} satisfies Prisma.KitchenTicketInclude;

export type KitchenTicketView = Prisma.KitchenTicketGetPayload<{ include: typeof ticketInclude }>;

async function loadTicket(establishmentId: string, ticketId: string, tx?: Tx): Promise<KitchenTicketView> {
  const db = tx ?? prisma;
  const t = await db.kitchenTicket.findFirst({ where: { id: ticketId, order: { establishmentId } }, include: ticketInclude });
  if (!t) throw new ApiError(404, "NOT_FOUND", "Ticket cuisine introuvable");
  return t;
}

/** Tickets à afficher : actifs, plus (option) ceux terminés ou annulés récemment pour un rappel. */
export async function listKitchenTickets(establishmentId: string, opts: { stationId?: string | null; includeDone?: boolean; recentMinutes?: number } = {}) {
  const since = new Date(Date.now() - (opts.recentMinutes ?? 30) * 60_000);
  const tickets = await prisma.kitchenTicket.findMany({
    where: {
      order: { establishmentId },
      ...(opts.stationId ? { stationId: opts.stationId } : {}),
      OR: [
        { status: { in: ACTIVE_TICKET_STATUSES } },
        ...(opts.includeDone ? [{ status: { in: ["DONE", "CANCELLED"] as KitchenTicketStatus[] }, OR: [{ completedAt: { gte: since } }, { completedAt: null, createdAt: { gte: since } }] }] : []),
      ],
    },
    include: ticketInclude,
    orderBy: [{ isUrgent: "desc" }, { createdAt: "asc" }],
  });
  // Un ticket dont tous les articles ont été annulés n'a plus rien à préparer
  return tickets.filter((t) => t.status !== "CANCELLED" || opts.includeDone).filter((t) => t.items.some((i) => i.status !== "VOIDED") || opts.includeDone);
}

/** Synchronise le statut du service et de la commande avec l'état de ses tickets. */
async function syncCourse(tx: Tx, courseId: string | null) {
  if (!courseId) return;
  const tickets = await tx.kitchenTicket.findMany({ where: { courseId, status: { not: "CANCELLED" } }, select: { status: true } });
  if (tickets.length === 0) return;
  const course = await tx.course.findUnique({ where: { id: courseId }, select: { status: true } });
  if (!course || !["SENT", "FIRE", "READY", "SERVED"].includes(course.status)) return;
  const allDone = tickets.every((t) => t.status === "DONE");
  const allReady = tickets.every((t) => t.status === "READY" || t.status === "DONE");
  // Phase 9 : un service n'est « servi » que lorsque ses articles ont été apportés à la table
  const toBring = allDone ? await tx.orderItem.count({ where: { courseId, status: { in: ["SENT", "PREPARING", "READY"] } } }) : 1;
  const next = allDone && toBring === 0 ? "SERVED" : allReady ? "READY" : course.status === "FIRE" ? "FIRE" : "SENT";
  if (next !== course.status) await tx.course.update({ where: { id: courseId }, data: { status: next } });
}

/** ACCEPTER / EN PRÉPARATION / PRÊT / TERMINÉ (et rappel d'un ticket terminé). */
export async function setTicketStatus(actor: Actor, ticketId: string, status: KitchenTicketStatus) {
  if (!ACTION_STATUSES.includes(status)) throw new ApiError(400, "BAD_STATUS", "Statut cuisine invalide");
  const ticket = await loadTicket(actor.establishmentId, ticketId);
  if (ticket.status === "CANCELLED") throw new ApiError(409, "TICKET_CANCELLED", "Ce ticket a été annulé");
  if (ticket.status === status) return ticket;
  const now = new Date();
  const itemIds = ticket.items.filter((i) => i.status !== "VOIDED").map((i) => i.id);
  // Phase 9 : avec le suivi de service, « terminé » en cuisine ne vaut pas « apporté à la table »
  const tracking = ticket.order.type === "DINE_IN" && (await serviceSettings(actor.establishmentId)).enabled;
  await prisma.$transaction(async (tx) => {
    const data: Prisma.KitchenTicketUpdateInput = { status };
    if (status === "ACCEPTED") data.acceptedAt = ticket.acceptedAt ?? now;
    if (status === "IN_PROGRESS") { data.acceptedAt = ticket.acceptedAt ?? now; data.startedAt = ticket.startedAt ?? now; }
    if (status === "READY") { data.acceptedAt = ticket.acceptedAt ?? now; data.startedAt = ticket.startedAt ?? now; data.readyAt = now; data.completedAt = null; }
    if (status === "DONE") { data.acceptedAt = ticket.acceptedAt ?? now; data.startedAt = ticket.startedAt ?? now; data.readyAt = ticket.readyAt ?? now; data.completedAt = now; }
    await tx.kitchenTicket.update({ where: { id: ticketId }, data });
    if (itemIds.length > 0) {
      if (status === "IN_PROGRESS") await tx.orderItem.updateMany({ where: { id: { in: itemIds }, status: { in: ["SENT", "READY"] } }, data: { status: "PREPARING", readyAt: null } });
      if (status === "READY") await tx.orderItem.updateMany({ where: { id: { in: itemIds }, status: { in: ["SENT", "PREPARING", "SERVED"] } }, data: { status: "READY", readyAt: now, servedAt: null } });
      if (status === "DONE") {
        if (tracking) await tx.orderItem.updateMany({ where: { id: { in: itemIds }, status: { in: ["SENT", "PREPARING"] } }, data: { status: "READY", readyAt: now } });
        else await tx.orderItem.updateMany({ where: { id: { in: itemIds }, status: { in: ["SENT", "PREPARING", "READY"] } }, data: { status: "SERVED", servedAt: now } });
      }
      if (status === "ACCEPTED" || status === "IN_PROGRESS") await onTicketNotReady(tx, ticket.orderId, ticketId);
      if (status === "ACCEPTED") await tx.orderItem.updateMany({ where: { id: { in: itemIds }, status: { in: ["PREPARING", "READY"] } }, data: { status: "SENT", readyAt: null } });
    }
    await syncCourse(tx, ticket.courseId);
    await tx.order.update({ where: { id: ticket.orderId }, data: { version: { increment: 1 } } });
    await audit({ ...actor, action: "kitchen.ticket.status", entityType: "kitchen_ticket", entityId: ticketId, oldValue: { status: ticket.status }, newValue: { status, orderNumber: ticket.order.number, station: ticket.station?.name ?? null } }, tx);
  });
  publish("kitchen.updated", actor.establishmentId, { orderId: ticket.orderId, ticketId, status });
  publish("order.updated", actor.establishmentId, { orderId: ticket.orderId, tableId: ticket.order.table?.id ?? null });
  publish("table.updated", actor.establishmentId, { tableId: ticket.order.table?.id ?? null });
  // À emporter : dernier plat prêt → la commande est prête (numéro appelé, client prévenu)
  if (status === "READY" || status === "DONE") await syncTakeawayReady(actor.establishmentId, ticket.orderId).catch((e) => console.error("[à emporter] statut prêt non mis à jour", e));
  const after = await loadTicket(actor.establishmentId, ticketId);
  if (tracking && (status === "READY" || status === "DONE")) await onTicketReady(actor, { id: after.id, orderId: after.orderId, items: after.items, order: { tableId: after.order.table?.id ?? null, serverId: after.order.serverId, type: after.order.type } });
  // Notification push « plat prêt » sur le téléphone du serveur (une fois : au passage à PRÊT, ou TERMINÉ sans être passé par PRÊT)
  if (status === "READY" || (status === "DONE" && ticket.status !== "READY")) notifyDishReady(actor, { orderId: after.orderId, items: after.items, course: after.course, order: { number: after.order.number, type: after.order.type, serverId: after.order.serverId, customerName: after.order.customerName, tableLabel: after.order.tableLabel, table: after.order.table } }).catch((e) => console.warn("[push] plat prêt non notifié", e));
  return after;
}

/** Coche un article comme prêt (ou l'inverse) ; le ticket passe PRÊT quand tous ses articles le sont. */
export async function setItemReady(actor: Actor, ticketId: string, itemId: string, ready: boolean) {
  const ticket = await loadTicket(actor.establishmentId, ticketId);
  if (!ACTIVE_TICKET_STATUSES.includes(ticket.status)) throw new ApiError(409, "TICKET_CLOSED", "Ce ticket n'est plus en cours");
  const item = ticket.items.find((i) => i.id === itemId);
  if (!item || item.status === "VOIDED") throw new ApiError(404, "NOT_FOUND", "Article introuvable");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.orderItem.update({ where: { id: itemId }, data: ready ? { status: "READY", readyAt: now } : { status: "PREPARING", readyAt: null } });
    if (ticket.status === "NEW") await tx.kitchenTicket.update({ where: { id: ticketId }, data: { status: "IN_PROGRESS", acceptedAt: ticket.acceptedAt ?? now, startedAt: ticket.startedAt ?? now } });
    await tx.order.update({ where: { id: ticket.orderId }, data: { version: { increment: 1 } } });
  });
  const after = await loadTicket(actor.establishmentId, ticketId);
  const live = after.items.filter((i) => i.status !== "VOIDED");
  if (ready && live.length > 0 && live.every((i) => i.status === "READY" || i.status === "SERVED")) return setTicketStatus(actor, ticketId, "READY");
  if (!ready && after.status === "READY") return setTicketStatus(actor, ticketId, "IN_PROGRESS");
  publish("kitchen.updated", actor.establishmentId, { orderId: ticket.orderId, ticketId, itemId });
  publish("order.updated", actor.establishmentId, { orderId: ticket.orderId, tableId: ticket.order.table?.id ?? null });
  return after;
}

/** Postes avec compteurs par statut, ticket le plus ancien et temps moyen de préparation du jour. */
export async function kitchenSummary(establishmentId: string) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true } });
  const dayStart = startOfLocalDay(localDay(new Date(), est.timezone), est.timezone);
  const [stations, active, today] = await Promise.all([
    prisma.kitchenStation.findMany({ where: { establishmentId, isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, color: true, warnAfterSec: true, alertAfterSec: true } }),
    prisma.kitchenTicket.findMany({ where: { order: { establishmentId }, status: { in: ACTIVE_TICKET_STATUSES } }, select: { stationId: true, status: true, createdAt: true, isUrgent: true } }),
    prisma.kitchenTicket.findMany({ where: { order: { establishmentId }, createdAt: { gte: dayStart }, readyAt: { not: null } }, select: { stationId: true, createdAt: true, readyAt: true } }),
  ]);
  const now = Date.now();
  const perStation = (id: string | null) => {
    const mine = active.filter((t) => (t.stationId ?? null) === id);
    const counts = { NEW: 0, ACCEPTED: 0, IN_PROGRESS: 0, READY: 0 } as Record<"NEW" | "ACCEPTED" | "IN_PROGRESS" | "READY", number>;
    for (const t of mine) counts[t.status as keyof typeof counts]++;
    const oldest = mine.filter((t) => t.status !== "READY").reduce((a, t) => Math.max(a, now - t.createdAt.getTime()), 0);
    const done = today.filter((t) => (t.stationId ?? null) === id);
    const avgSec = done.length ? Math.round(done.reduce((a, t) => a + (t.readyAt!.getTime() - t.createdAt.getTime()) / 1000, 0) / done.length) : null;
    return { counts, total: mine.length, urgent: mine.filter((t) => t.isUrgent).length, oldestSec: Math.round(oldest / 1000), doneToday: done.length, avgPrepSec: avgSec };
  };
  const unassigned = active.filter((t) => !t.stationId).length;
  return {
    stations: stations.map((s) => ({ ...s, ...perStation(s.id) })),
    unassigned: { ...perStation(null), total: unassigned },
    all: { total: active.length, counts: { NEW: active.filter((t) => t.status === "NEW").length, ACCEPTED: active.filter((t) => t.status === "ACCEPTED").length, IN_PROGRESS: active.filter((t) => t.status === "IN_PROGRESS").length, READY: active.filter((t) => t.status === "READY").length }, doneToday: today.length, avgPrepSec: today.length ? Math.round(today.reduce((a, t) => a + (t.readyAt!.getTime() - t.createdAt.getTime()) / 1000, 0) / today.length) : null },
  };
}

/** Données d'un ticket pour l'impression cuisine. */
export async function getKitchenTicket(establishmentId: string, ticketId: string) {
  return loadTicket(establishmentId, ticketId);
}
