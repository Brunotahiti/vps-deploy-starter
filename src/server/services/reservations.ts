import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";
import { createOrder, type Actor } from "./orders";
import { findOrCreatePublicCustomer } from "./customers";
import type { ReservationStatus } from "@/generated/prisma/client";

/** Phase 6 — Réservations : prise (interne ou publique), confirmation, arrivée, installation (ouvre la commande), no-show. */
const include = { table: { select: { id: true, name: true, roomId: true, seats: true } }, customer: { select: { id: true, firstName: true, lastName: true, phone: true, visitCount: true, allergies: true } } };

export async function listReservations(establishmentId: string, day: string, timezone: string) {
  return prisma.reservation.findMany({ where: { establishmentId, startsAt: { gte: startOfLocalDay(day, timezone), lt: endOfLocalDay(day, timezone) } }, orderBy: { startsAt: "asc" }, include });
}

export async function upsertReservation(actor: Actor, input: { id?: string; name: string; phone?: string | null; email?: string | null; startsAt: string; partySize: number; tableId?: string | null; notes?: string | null; allergies?: string | null; status?: ReservationStatus; customerId?: string | null }) {
  if (input.tableId) {
    const t = await prisma.table.findFirst({ where: { id: input.tableId, establishmentId: actor.establishmentId } });
    if (!t) throw new ApiError(400, "BAD_TABLE", "Table invalide");
  }
  const data = { name: input.name, phone: input.phone ?? null, email: input.email ?? null, startsAt: new Date(input.startsAt), partySize: input.partySize, tableId: input.tableId ?? null, notes: input.notes ?? null, allergies: input.allergies ?? null, ...(input.status ? { status: input.status } : {}), ...(input.customerId !== undefined ? { customerId: input.customerId } : {}) };
  let row;
  if (input.id) {
    const existing = await prisma.reservation.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Réservation introuvable");
    row = await prisma.reservation.update({ where: { id: input.id }, data, include });
  } else {
    row = await prisma.$transaction(async (tx) => {
      const customer = input.customerId ? null : await findOrCreatePublicCustomer(tx, actor.organizationId, { name: input.name, phone: input.phone, email: input.email });
      return tx.reservation.create({ data: { establishmentId: actor.establishmentId, ...data, status: input.status ?? "CONFIRMED", customerId: input.customerId ?? customer?.id ?? null }, include });
    });
    await audit({ ...actor, action: "reservation.create", entityType: "reservation", entityId: row.id, newValue: { name: row.name, startsAt: row.startsAt, partySize: row.partySize } });
  }
  publish("floor.updated", actor.establishmentId, { reservationId: row.id });
  return row;
}

/** Réservation publique (formulaire client) : statut PENDING, à confirmer par le restaurant. */
export async function createPublicReservation(establishmentId: string, organizationId: string, input: { name: string; phone: string; email?: string | null; startsAt: string; partySize: number; notes?: string | null; allergies?: string | null }) {
  const startsAt = new Date(input.startsAt);
  if (!(startsAt.getTime() > Date.now() - 5 * 60_000)) throw new ApiError(400, "BAD_DATE", "La date doit être dans le futur");
  const row = await prisma.$transaction(async (tx) => {
    const customer = await findOrCreatePublicCustomer(tx, organizationId, { name: input.name, phone: input.phone, email: input.email });
    return tx.reservation.create({ data: { establishmentId, customerId: customer.id, name: input.name, phone: input.phone, email: input.email ?? null, startsAt, partySize: input.partySize, notes: input.notes ?? null, allergies: input.allergies ?? null, status: "PENDING" }, include });
  });
  publish("floor.updated", establishmentId, { reservationId: row.id, publicReservation: true });
  return row;
}

const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["ARRIVED", "SEATED", "CANCELLED", "NO_SHOW"], ARRIVED: ["SEATED", "CANCELLED"], SEATED: ["COMPLETED"], COMPLETED: [], CANCELLED: ["CONFIRMED"], NO_SHOW: ["CONFIRMED"],
};

/** Changement de statut ; « installée » ouvre la commande sur la table (couverts = taille du groupe, client rattaché). */
export async function setReservationStatus(actor: Actor, id: string, status: ReservationStatus, tableId?: string | null) {
  const r = await prisma.reservation.findFirst({ where: { id, establishmentId: actor.establishmentId }, include });
  if (!r) throw new ApiError(404, "NOT_FOUND", "Réservation introuvable");
  if (!TRANSITIONS[r.status].includes(status)) throw new ApiError(409, "BAD_TRANSITION", `Passage ${r.status} → ${status} impossible`);
  const table = tableId ?? r.tableId;
  let orderId: string | null = null;
  if (status === "SEATED") {
    if (!table) throw new ApiError(400, "TABLE_REQUIRED", "Choisissez une table pour installer les clients");
    const order = await createOrder(actor, { type: "DINE_IN", tableId: table, covers: r.partySize, customerName: r.name, notes: r.allergies ? `Allergies : ${r.allergies}` : null });
    if (r.customerId) await prisma.order.update({ where: { id: order.id }, data: { customerId: r.customerId } });
    orderId = order.id;
  }
  if (status === "CONFIRMED" || status === "ARRIVED") { if (table) await prisma.table.updateMany({ where: { id: table, state: "FREE" }, data: { state: "RESERVED" } }); }
  if (status === "SEATED" || status === "CANCELLED" || status === "NO_SHOW" || status === "COMPLETED") { if (table) await prisma.table.updateMany({ where: { id: table, state: "RESERVED" }, data: { state: "FREE" } }); }
  const updated = await prisma.reservation.update({ where: { id }, data: { status, tableId: table ?? null }, include });
  await audit({ ...actor, action: "reservation.status", entityType: "reservation", entityId: id, oldValue: { status: r.status }, newValue: { status, orderId } });
  publish("floor.updated", actor.establishmentId, { reservationId: id });
  publish("table.updated", actor.establishmentId, { tableId: table });
  return { ...updated, orderId };
}
