import { prisma } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { addDays, endOfLocalDay, formatTime, localDay, startOfLocalDay } from "@/lib/dates";
import { ACTIVE_RESERVATION, isReservationTag, normalizeReservationSettings, phoneKey, type ReservationSettings, type ReservationSource } from "@/lib/reservations";
import { isEmailConfigured, reservationMail, sendMail } from "@/server/email/mailer";
import { createOrder, type Actor } from "./orders";
import { findOrCreatePublicCustomer } from "./customers";
import { privatizedAt } from "./catering";
import { isDemoEstablishment } from "./demo";
import type { Prisma, ReservationStatus } from "@/generated/prisma/client";

/**
 * Réservations : prise au téléphone (programme de base) ou en ligne (option Digital), confirmation, arrivée,
 * installation (ouvre la commande), no-show. Une table n'est jamais donnée deux fois sur le même créneau.
 */
const include = { table: { select: { id: true, name: true, roomId: true, seats: true } }, customer: { select: { id: true, firstName: true, lastName: true, phone: true, visitCount: true, allergies: true } } };

export async function listReservations(establishmentId: string, day: string, timezone: string) {
  return prisma.reservation.findMany({ where: { establishmentId, startsAt: { gte: startOfLocalDay(day, timezone), lt: endOfLocalDay(day, timezone) } }, orderBy: { startsAt: "asc" }, include });
}

type ReservationInput = { id?: string; name: string; phone?: string | null; email?: string | null; startsAt: string; partySize: number; tableId?: string | null; notes?: string | null; allergies?: string | null; status?: ReservationStatus; customerId?: string | null; durationMinutes?: number; source?: ReservationSource; tags?: string[]; notify?: boolean };

/** Réservation déjà posée sur cette table et qui chevauche le créneau (null : la table est libre) */
export async function tableConflict(establishmentId: string, tableId: string, startsAt: Date, durationMinutes: number, excludeId?: string) {
  const end = startsAt.getTime() + durationMinutes * 60_000;
  const around = await prisma.reservation.findMany({
    where: { establishmentId, tableId, status: { in: [...ACTIVE_RESERVATION] }, startsAt: { gte: new Date(startsAt.getTime() - 6 * 3600_000), lt: new Date(end) }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true, startsAt: true, durationMinutes: true },
  });
  return around.find((r) => r.startsAt.getTime() + r.durationMinutes * 60_000 > startsAt.getTime()) ?? null;
}

export async function upsertReservation(actor: Actor, input: ReservationInput) {
  const startsAt = new Date(input.startsAt);
  const existing = input.id ? await prisma.reservation.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } }) : null;
  if (input.id && !existing) throw new ApiError(404, "NOT_FOUND", "Réservation introuvable");
  const settings = await reservationSettings(actor.establishmentId);
  const durationMinutes = input.durationMinutes ?? existing?.durationMinutes ?? settings.duration;
  if (input.tableId && input.tableId !== existing?.tableId) {
    const t = await prisma.table.findFirst({ where: { id: input.tableId, establishmentId: actor.establishmentId, isActive: true } });
    if (!t) throw new ApiError(400, "BAD_TABLE", "Table invalide");
  }
  const finalTable = input.tableId === undefined ? existing?.tableId ?? null : input.tableId;
  if (finalTable) {
    const clash = await tableConflict(actor.establishmentId, finalTable, startsAt, durationMinutes, input.id);
    if (clash) {
      const t = await prisma.table.findUniqueOrThrow({ where: { id: finalTable }, select: { name: true } });
      throw new ApiError(409, "TABLE_TAKEN", `La table ${t.name} est déjà réservée à ${formatTime(clash.startsAt, await timezoneOf(actor.establishmentId))} (${clash.name}) : choisissez une autre table`);
    }
  }
  if (input.customerId && !(await prisma.customer.findFirst({ where: { id: input.customerId, organizationId: actor.organizationId } }))) throw new ApiError(400, "BAD_CUSTOMER", "Client invalide");
  const tags = input.tags ? [...new Set(input.tags.filter(isReservationTag))] : undefined;
  const data = {
    name: input.name.trim(), phone: input.phone?.trim() || null, email: input.email?.trim() || null, startsAt, partySize: input.partySize, durationMinutes,
    tableId: input.tableId === undefined ? existing?.tableId ?? null : input.tableId, notes: input.notes?.trim() || null, allergies: input.allergies?.trim() || null,
    ...(tags ? { tags } : {}), ...(input.source ? { source: input.source } : {}), ...(input.status ? { status: input.status } : {}), ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
  };
  let row;
  if (existing) {
    row = await prisma.reservation.update({ where: { id: existing.id }, data, include });
    await audit({ ...actor, action: "reservation.update", entityType: "reservation", entityId: row.id, oldValue: { startsAt: existing.startsAt, partySize: existing.partySize, tableId: existing.tableId }, newValue: { startsAt: row.startsAt, partySize: row.partySize, tableId: row.tableId } });
  } else {
    const who = await prisma.user.findUnique({ where: { id: actor.userId }, select: { firstName: true, displayName: true } });
    row = await prisma.$transaction(async (tx) => {
      const customer = input.customerId ? null : await findOrCreatePublicCustomer(tx, actor.organizationId, { name: data.name, phone: data.phone, email: data.email });
      // Les allergies dites au téléphone rejoignent la fiche du client pour les prochaines fois
      if (customer && data.allergies && !customer.allergies) await tx.customer.update({ where: { id: customer.id }, data: { allergies: data.allergies } });
      return tx.reservation.create({ data: { establishmentId: actor.establishmentId, ...data, source: input.source ?? "PHONE", status: input.status ?? "CONFIRMED", customerId: input.customerId ?? customer?.id ?? null, createdByName: who?.displayName?.trim() || who?.firstName || null }, include });
    });
    await audit({ ...actor, action: "reservation.create", entityType: "reservation", entityId: row.id, newValue: { name: row.name, startsAt: row.startsAt, partySize: row.partySize, source: row.source } });
  }
  publish("floor.updated", actor.establishmentId, { reservationId: row.id });
  if (input.notify && row.email) await notifyCustomer(actor.establishmentId, row, existing ? "updated" : "confirmed");
  return row;
}

/**
 * Programme de base : réservation simple (nom, téléphone, personnes, jour, heure, notes, allergies).
 * Table attribuée d'avance, durée, repères et e-mail de confirmation font partie des réservations avancées (option Digital).
 */
export function simpleReservation<T extends Partial<ReservationInput>>(ctx: { options: string[] }, input: T): T {
  if (ctx.options.includes("digital")) return input;
  const { tableId: _t, durationMinutes: _d, tags: _g, notify: _n, ...rest } = input;
  void _t; void _d; void _g; void _n;
  return rest as T;
}

/** E-mail de confirmation au client (si une adresse est connue et l'envoi d'e-mails configuré) */
/** E-mail au client ; true s'il est réellement parti. */
async function notifyCustomer(establishmentId: string, r: { email: string | null; name: string; startsAt: Date; partySize: number }, kind: "received" | "confirmed" | "declined" | "updated" | "cancelled", message?: string | null): Promise<boolean> {
  if (!r.email || !isEmailConfigured()) return false;
  if (await isDemoEstablishment(establishmentId)) return false; // restaurant exemple : jamais d'e-mail réel
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { name: true, timezone: true, phone: true, addressLine1: true, city: true } });
  return sendMail(reservationMail({
    to: r.email, kind, establishmentName: est.name, name: r.name, partySize: r.partySize,
    dateLabel: new Intl.DateTimeFormat("fr-FR", { timeZone: est.timezone, weekday: "long", day: "numeric", month: "long" }).format(r.startsAt), timeLabel: formatTime(r.startsAt, est.timezone),
    phone: est.phone, address: [est.addressLine1, est.city].filter(Boolean).join(", ") || null, message: message ?? null,
  })).then(() => true, () => false);
}

const timezoneOf = async (establishmentId: string) => (await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true } })).timezone;

/** Réglages des réservations (services, créneaux, durée d'une table, couverts au plus par service) */
export async function reservationSettings(establishmentId: string): Promise<ReservationSettings> {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { settings: true } });
  return normalizeReservationSettings(((est.settings ?? {}) as { reservations?: unknown }).reservations);
}

export async function updateReservationSettings(actor: Actor, patch: Partial<ReservationSettings>) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { settings: true } });
  const current = (est.settings ?? {}) as Record<string, unknown>;
  const prev = normalizeReservationSettings(current.reservations);
  const next = normalizeReservationSettings({ ...prev, ...patch });
  await prisma.establishment.update({ where: { id: actor.establishmentId }, data: { settings: { ...current, reservations: next } as Prisma.InputJsonValue } });
  await audit({ ...actor, action: "settings.reservations", entityType: "establishment", entityId: actor.establishmentId, oldValue: prev, newValue: next });
  return next;
}

/**
 * Client qui appelle : retrouvé par son numéro (8 derniers chiffres), avec ses visites, ses absences sans prévenir
 * et ses prochaines réservations, pour l'accueillir par son nom et éviter les doublons.
 */
export async function lookupCaller(actor: Actor, phone: string) {
  const key = phoneKey(phone);
  if (key.length < 6) return null;
  const candidates = await prisma.customer.findMany({ where: { organizationId: actor.organizationId, phone: { contains: key.slice(-4) } }, orderBy: { updatedAt: "desc" }, take: 50 });
  const c = candidates.find((x) => phoneKey(x.phone) === key);
  if (!c) return null;
  const history = await prisma.reservation.groupBy({ by: ["status"], where: { customerId: c.id, establishmentId: actor.establishmentId }, _count: true });
  const count = (st: ReservationStatus) => history.find((h) => h.status === st)?._count ?? 0;
  const upcoming = await prisma.reservation.findMany({ where: { customerId: c.id, establishmentId: actor.establishmentId, status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gte: new Date(Date.now() - 2 * 3600_000) } }, orderBy: { startsAt: "asc" }, take: 3, select: { id: true, startsAt: true, partySize: true } });
  const lastVisit = await prisma.order.findFirst({ where: { customerId: c.id, establishmentId: actor.establishmentId, status: "PAID" }, orderBy: { openedAt: "desc" }, select: { openedAt: true } });
  return {
    id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" "), phone: c.phone, email: c.email, allergies: c.allergies, notes: c.notes,
    visitCount: c.visitCount, lastVisit: lastVisit?.openedAt ?? null, noShows: count("NO_SHOW"), cancelled: count("CANCELLED"), honoured: count("COMPLETED") + count("SEATED"), upcoming,
  };
}

/** Une ligne par jour : réservations, couverts et demandes à confirmer (bandeau de la semaine) */
export async function reservationSummary(establishmentId: string, from: string, days: number, timezone: string) {
  const rows = await prisma.reservation.findMany({
    where: { establishmentId, status: { notIn: ["CANCELLED", "NO_SHOW"] }, startsAt: { gte: startOfLocalDay(from, timezone), lt: endOfLocalDay(addDays(from, days - 1), timezone) } },
    select: { startsAt: true, partySize: true, status: true },
  });
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i);
    const mine = rows.filter((r) => localDay(r.startsAt, timezone) === day);
    return { day, count: mine.length, covers: mine.reduce((a, r) => a + r.partySize, 0), pending: mine.filter((r) => r.status === "PENDING").length };
  });
}

/** Demandes de réservation en ligne à valider (à venir), les plus anciennes d'abord : grande alerte de la caisse et de la gestion. */
export async function pendingReservations(establishmentId: string) {
  return prisma.reservation.findMany({
    where: { establishmentId, status: "PENDING", startsAt: { gte: new Date(Date.now() - 2 * 3600_000) } },
    orderBy: { createdAt: "asc" }, take: 100,
    select: { id: true, name: true, phone: true, email: true, startsAt: true, partySize: true, notes: true, allergies: true, createdAt: true, source: true },
  });
}

/** Réservation publique (formulaire client) : statut PENDING, à confirmer par le restaurant. */
const PUBLIC_MAX_DAYS_AHEAD = 180;
const PUBLIC_MAX_PER_PHONE = 3;

export async function createPublicReservation(establishmentId: string, organizationId: string, input: { name: string; phone: string; email: string; startsAt: string; partySize: number; notes?: string | null; allergies?: string | null }) {
  const startsAt = new Date(input.startsAt);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email ?? "")) throw new ApiError(400, "EMAIL_REQUIRED", "E-mail obligatoire : le restaurant vous répond par e-mail");
  if (!(startsAt.getTime() > Date.now() - 5 * 60_000)) throw new ApiError(400, "BAD_DATE", "La date doit être dans le futur");
  if (startsAt.getTime() > Date.now() + PUBLIC_MAX_DAYS_AHEAD * 86_400_000) throw new ApiError(400, "BAD_DATE", `Réservation possible jusqu'à ${PUBLIC_MAX_DAYS_AHEAD} jours à l'avance`);
  // Contre les fausses réservations : un même numéro ne bloque pas la salle avec des demandes à répétition
  // Comparaison sur les 8 derniers chiffres : « +689 87 00 00 01 » et « 87000001 » sont le même numéro
  const phoneKey = (p: string) => p.replace(/\D/g, "").slice(-8);
  const digits = phoneKey(input.phone);
  const upcoming = await prisma.reservation.findMany({ where: { establishmentId, status: { in: ["PENDING", "CONFIRMED"] }, startsAt: { gte: new Date(Date.now() - 3 * 3600_000) } }, select: { phone: true, startsAt: true }, take: 2000 });
  const mine = upcoming.filter((r) => r.phone && phoneKey(r.phone) === digits);
  // Même service (moins de 4 h d'écart) : c'est un doublon, pas une seconde table
  if (mine.some((r) => Math.abs(r.startsAt.getTime() - startsAt.getTime()) < 4 * 3600_000)) throw new ApiError(409, "ALREADY_BOOKED", "Une réservation existe déjà à ce numéro pour ce service : contactez le restaurant pour la modifier");
  if (mine.length >= PUBLIC_MAX_PER_PHONE) throw new ApiError(409, "TOO_MANY_RESERVATIONS", `${PUBLIC_MAX_PER_PHONE} réservations à venir au plus par numéro de téléphone : contactez le restaurant`);
  // Restaurant privatisé (événement traiteur confirmé) : pas de réservation en ligne sur ce créneau
  const duration = (await reservationSettings(establishmentId)).duration;
  if (await privatizedAt(establishmentId, startsAt, duration)) throw new ApiError(409, "PRIVATIZED", "Le restaurant est privatisé pour un événement à ce moment-là : choisissez un autre créneau ou appelez-nous");
  const row = await prisma.$transaction(async (tx) => {
    const customer = await findOrCreatePublicCustomer(tx, organizationId, { name: input.name, phone: input.phone, email: input.email });
    return tx.reservation.create({ data: { establishmentId, customerId: customer.id, name: input.name, phone: input.phone, email: input.email.trim(), startsAt, partySize: input.partySize, notes: input.notes ?? null, allergies: input.allergies ?? null, status: "PENDING", source: "ONLINE", durationMinutes: duration }, include });
  });
  publish("floor.updated", establishmentId, { reservationId: row.id, publicReservation: true });
  // Accusé de réception : le client sait que sa demande attend la réponse du restaurant (par e-mail).
  // 3 par adresse et par jour au plus : le formulaire public ne doit pas servir à écrire à n'importe qui
  const mailAllowed = await rateLimit(`reserve-mail:${input.email.trim().toLowerCase()}`, 3, 86_400_000).then(() => true, () => false);
  if (mailAllowed) await notifyCustomer(establishmentId, row, "received");
  return row;
}

const TRANSITIONS: Record<ReservationStatus, ReservationStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"], CONFIRMED: ["ARRIVED", "SEATED", "CANCELLED", "NO_SHOW"], ARRIVED: ["SEATED", "CANCELLED"], SEATED: ["COMPLETED"], COMPLETED: [], CANCELLED: ["CONFIRMED"], NO_SHOW: ["CONFIRMED"],
};

/** Changement de statut ; « installée » ouvre la commande sur la table (couverts = taille du groupe, client rattaché). */
export async function setReservationStatus(actor: Actor, id: string, status: ReservationStatus, tableId?: string | null, notify = false, message?: string | null, expect?: ReservationStatus) {
  const r = await prisma.reservation.findFirst({ where: { id, establishmentId: actor.establishmentId }, include });
  if (!r) throw new ApiError(404, "NOT_FOUND", "Réservation introuvable");
  // Écran resté ouvert : la demande a déjà été traitée par un collègue
  if (expect && r.status !== expect) throw new ApiError(409, "ALREADY_HANDLED", `Réservation de ${r.name} déjà traitée par un collègue`);
  if (!TRANSITIONS[r.status].includes(status)) throw new ApiError(409, "BAD_TRANSITION", `Passage ${r.status} → ${status} impossible`);
  const table = tableId ?? r.tableId;
  if (tableId && !(await prisma.table.findFirst({ where: { id: tableId, establishmentId: actor.establishmentId } }))) throw new ApiError(400, "BAD_TABLE", "Table invalide");
  if (status === "SEATED" && !table) throw new ApiError(400, "TABLE_REQUIRED", "Choisissez une table pour installer les clients");
  // Une table choisie au dernier moment ne doit pas être déjà promise à quelqu'un d'autre
  if (tableId && tableId !== r.tableId && (status === "CONFIRMED" || status === "ARRIVED")) {
    const clash = await tableConflict(actor.establishmentId, tableId, r.startsAt, r.durationMinutes, r.id);
    if (clash) throw new ApiError(409, "TABLE_TAKEN", `Cette table est déjà réservée (${clash.name})`);
  }
  // Passage réservé d'un seul coup : deux appuis simultanés (ou confirmer ici et refuser ailleurs) ne passent pas tous les deux,
  // et le client ne reçoit jamais deux réponses contradictoires
  const claimed = await prisma.reservation.updateMany({ where: { id, establishmentId: actor.establishmentId, status: r.status }, data: { status } });
  if (!claimed.count) throw new ApiError(409, "ALREADY_HANDLED", `Réservation de ${r.name} modifiée entre-temps : rechargez`);
  let orderId: string | null = null;
  let updated;
  try {
    if (status === "SEATED" && table) {
      const order = await createOrder(actor, { type: "DINE_IN", tableId: table, covers: r.partySize, customerName: r.name, notes: r.allergies ? `Allergies : ${r.allergies}` : null });
      if (r.customerId) await prisma.order.update({ where: { id: order.id }, data: { customerId: r.customerId } });
      orderId = order.id;
    }
    if (status === "SEATED" || status === "CANCELLED" || status === "NO_SHOW" || status === "COMPLETED") { if (table) await prisma.table.updateMany({ where: { id: table, establishmentId: actor.establishmentId, state: "RESERVED" }, data: { state: "FREE" } }); }
    updated = await prisma.reservation.update({ where: { id }, data: { tableId: table ?? null }, include });
  } catch (e) {
    // Échec (table occupée…) : la réservation reprend son statut d'avant
    await prisma.reservation.updateMany({ where: { id, status }, data: { status: r.status } });
    throw e;
  }
  await audit({ ...actor, action: "reservation.status", entityType: "reservation", entityId: id, oldValue: { status: r.status }, newValue: { status, orderId } });
  publish("floor.updated", actor.establishmentId, { reservationId: id });
  publish("table.updated", actor.establishmentId, { tableId: table });
  // Demande en ligne : le client attend la réponse du restaurant, toujours envoyée par e-mail (confirmée ou refusée)
  let emailed = false;
  if (r.status === "PENDING" && r.source === "ONLINE" && (status === "CONFIRMED" || status === "CANCELLED")) emailed = await notifyCustomer(actor.establishmentId, updated, status === "CONFIRMED" ? "confirmed" : "declined", message);
  else if (status === "CANCELLED" && r.status !== "CANCELLED" && notify) emailed = await notifyCustomer(actor.establishmentId, updated, "cancelled", message);
  return { ...updated, orderId, emailed };
}
