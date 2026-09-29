import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { hashPin, verifyPin } from "@/server/auth/password";
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";
import type { Actor } from "./orders";
import type { TimeEntryKind } from "@/generated/prisma/client";

/**
 * Phase 5 — Personnel : employés, planning (shifts), pointage ARRIVÉE / PAUSE / REPRISE / DÉPART,
 * heures travaillées et coût du personnel.
 */
export const CLOCK_LABEL: Record<TimeEntryKind, string> = { CLOCK_IN: "Arrivée", BREAK_START: "Pause", BREAK_END: "Reprise", CLOCK_OUT: "Départ" };
export type ClockState = "OUT" | "IN" | "BREAK";

// ------------------------------------------------------------------ Employés
export async function listEmployees(establishmentId: string, includeInactive = false) {
  const rows = await prisma.employee.findMany({ where: { establishmentId, ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], include: { user: { select: { id: true, email: true, color: true, displayName: true } } } });
  return rows.map(({ pinHash, ...e }) => ({ ...e, hasPin: !!pinHash }));
}

export async function upsertEmployee(actor: Actor, input: { id?: string; userId?: string | null; firstName: string; lastName: string; jobTitle?: string | null; hourlyCost?: number | null; pin?: string | null; isActive?: boolean }) {
  if (input.userId) {
    const u = await prisma.user.findFirst({ where: { id: input.userId, organizationId: actor.organizationId } });
    if (!u) throw new ApiError(400, "BAD_USER", "Utilisateur inconnu");
    const taken = await prisma.employee.findFirst({ where: { userId: input.userId, ...(input.id ? { id: { not: input.id } } : {}) } });
    if (taken) throw new ApiError(409, "USER_LINKED", "Cet utilisateur est déjà lié à un employé");
  }
  const pinHash = input.pin ? await hashPin(input.pin) : undefined;
  if (input.id) {
    const existing = await prisma.employee.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Employé introuvable");
    const row = await prisma.employee.update({ where: { id: input.id }, data: { userId: input.userId, firstName: input.firstName, lastName: input.lastName, jobTitle: input.jobTitle, hourlyCost: input.hourlyCost, isActive: input.isActive, ...(pinHash ? { pinHash } : {}) } });
    await audit({ ...actor, action: "employee.update", entityType: "employee", entityId: row.id, oldValue: { hourlyCost: existing.hourlyCost, jobTitle: existing.jobTitle }, newValue: { hourlyCost: row.hourlyCost, jobTitle: row.jobTitle, pinChanged: !!pinHash } });
    return row;
  }
  const row = await prisma.employee.create({ data: { establishmentId: actor.establishmentId, userId: input.userId ?? null, firstName: input.firstName, lastName: input.lastName, jobTitle: input.jobTitle ?? null, hourlyCost: input.hourlyCost ?? null, pinHash: pinHash ?? null } });
  await audit({ ...actor, action: "employee.create", entityType: "employee", entityId: row.id, newValue: { name: `${row.firstName} ${row.lastName}`, jobTitle: row.jobTitle } });
  return row;
}

/** Crée une fiche employé pour chaque utilisateur de l'établissement qui n'en a pas encore. */
export async function createEmployeesFromUsers(actor: Actor) {
  const users = await prisma.user.findMany({ where: { organizationId: actor.organizationId, isActive: true, employee: null, OR: [{ memberships: { some: { establishmentId: actor.establishmentId } } }, { isOwner: true }] }, include: { memberships: { where: { establishmentId: actor.establishmentId }, include: { role: true } } } });
  let created = 0;
  for (const u of users) {
    await prisma.employee.create({ data: { establishmentId: actor.establishmentId, userId: u.id, firstName: u.firstName, lastName: u.lastName, jobTitle: u.memberships[0]?.role.name ?? (u.isOwner ? "Propriétaire" : null) } });
    created++;
  }
  if (created) await audit({ ...actor, action: "employee.import_users", entityType: "establishment", entityId: actor.establishmentId, newValue: { created } });
  return { created };
}

export async function archiveEmployee(actor: Actor, id: string) {
  const existing = await prisma.employee.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Employé introuvable");
  await prisma.employee.update({ where: { id }, data: { isActive: false } });
  await audit({ ...actor, action: "employee.archive", entityType: "employee", entityId: id });
}

// ------------------------------------------------------------------ Planning
export async function listShifts(establishmentId: string, from: Date, to: Date) {
  return prisma.shift.findMany({ where: { establishmentId, startsAt: { gte: from, lt: to } }, orderBy: { startsAt: "asc" }, include: { employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true, hourlyCost: true } } } });
}

export async function upsertShift(actor: Actor, input: { id?: string; employeeId: string; startsAt: string; endsAt: string; notes?: string | null }) {
  const emp = await prisma.employee.findFirst({ where: { id: input.employeeId, establishmentId: actor.establishmentId } });
  if (!emp) throw new ApiError(404, "NOT_FOUND", "Employé introuvable");
  const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
  if (!(endsAt > startsAt)) throw new ApiError(400, "BAD_RANGE", "La fin doit être après le début");
  if (endsAt.getTime() - startsAt.getTime() > 16 * 3600_000) throw new ApiError(400, "BAD_RANGE", "Un service ne peut pas dépasser 16 h");
  if (input.id) {
    const existing = await prisma.shift.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Service introuvable");
    return prisma.shift.update({ where: { id: input.id }, data: { employeeId: input.employeeId, startsAt, endsAt, notes: input.notes } });
  }
  return prisma.shift.create({ data: { establishmentId: actor.establishmentId, employeeId: input.employeeId, startsAt, endsAt, notes: input.notes ?? null } });
}

export async function deleteShift(actor: Actor, id: string) {
  const existing = await prisma.shift.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Service introuvable");
  await prisma.shift.delete({ where: { id } });
}

// ------------------------------------------------------------------ Pointage
const attempts = new Map<string, { count: number; until: number }>();
function limitPin(key: string) {
  const a = attempts.get(key);
  if (a && a.count >= 10 && Date.now() < a.until) throw new ApiError(429, "TOO_MANY_ATTEMPTS", "Trop de tentatives, réessayez dans une minute");
}
function notePinFailure(key: string) {
  const a = attempts.get(key) ?? { count: 0, until: 0 };
  attempts.set(key, { count: a.count + 1, until: Date.now() + 60_000 });
}

/** Retrouve l'employé par son PIN (PIN employé, sinon PIN de l'utilisateur lié). */
export async function identifyEmployee(establishmentId: string, pin: string) {
  const key = `clock:${establishmentId}`;
  limitPin(key);
  const employees = await prisma.employee.findMany({ where: { establishmentId, isActive: true }, include: { user: { select: { pinHash: true, isActive: true } } } });
  for (const e of employees) {
    if (e.pinHash && (await verifyPin(pin, e.pinHash))) { attempts.delete(key); return e; }
  }
  for (const e of employees) {
    if (!e.pinHash && e.user?.isActive && e.user.pinHash && (await verifyPin(pin, e.user.pinHash))) { attempts.delete(key); return e; }
  }
  notePinFailure(key);
  throw new ApiError(401, "BAD_PIN", "PIN inconnu");
}

/** État courant d'un employé d'après ses derniers pointages (une journée de travail = 20 h max). */
export async function clockState(employeeId: string) {
  const since = new Date(Date.now() - 20 * 3600_000);
  const entries = await prisma.timeEntry.findMany({ where: { employeeId, at: { gte: since } }, orderBy: { at: "asc" } });
  let state: ClockState = "OUT";
  let inAt: Date | null = null, breakAt: Date | null = null, workedMs = 0, breakMs = 0;
  for (const e of entries) {
    if (e.kind === "CLOCK_IN") { state = "IN"; inAt = e.at; workedMs = 0; breakMs = 0; breakAt = null; }
    else if (e.kind === "BREAK_START" && state === "IN") { state = "BREAK"; breakAt = e.at; workedMs += e.at.getTime() - (inAt?.getTime() ?? e.at.getTime()); }
    else if (e.kind === "BREAK_END" && state === "BREAK") { state = "IN"; breakMs += e.at.getTime() - (breakAt?.getTime() ?? e.at.getTime()); inAt = e.at; breakAt = null; }
    else if (e.kind === "CLOCK_OUT" && state !== "OUT") { if (state === "IN") workedMs += e.at.getTime() - (inAt?.getTime() ?? e.at.getTime()); else if (breakAt) breakMs += e.at.getTime() - breakAt.getTime(); state = "OUT"; inAt = null; breakAt = null; }
  }
  const now = Date.now();
  if (state === "IN" && inAt) workedMs += now - inAt.getTime();
  if (state === "BREAK" && breakAt) breakMs += now - breakAt.getTime();
  return { state: state as ClockState, entries, workedMs, breakMs, lastAt: entries.at(-1)?.at ?? null };
}

const ALLOWED: Record<ClockState, TimeEntryKind[]> = { OUT: ["CLOCK_IN"], IN: ["BREAK_START", "CLOCK_OUT"], BREAK: ["BREAK_END", "CLOCK_OUT"] };

export async function clock(establishmentId: string, pin: string, kind: TimeEntryKind, terminalId?: string | null) {
  const emp = await identifyEmployee(establishmentId, pin);
  const st = await clockState(emp.id);
  if (!ALLOWED[st.state].includes(kind)) throw new ApiError(409, "BAD_CLOCK_SEQUENCE", `Action impossible : ${emp.firstName} est ${st.state === "OUT" ? "hors service" : st.state === "IN" ? "en service" : "en pause"}`);
  const entry = await prisma.timeEntry.create({ data: { establishmentId, employeeId: emp.id, kind, terminalId: terminalId ?? null } });
  publish("catalog.updated", establishmentId, { staff: true });
  const after = await clockState(emp.id);
  return { employee: { id: emp.id, firstName: emp.firstName, lastName: emp.lastName, jobTitle: emp.jobTitle }, entry, ...after, allowed: ALLOWED[after.state] };
}

export async function clockStatus(establishmentId: string, pin: string) {
  const emp = await identifyEmployee(establishmentId, pin);
  const st = await clockState(emp.id);
  return { employee: { id: emp.id, firstName: emp.firstName, lastName: emp.lastName, jobTitle: emp.jobTitle }, ...st, allowed: ALLOWED[st.state] };
}

/** Qui est présent maintenant (en service ou en pause). */
export async function presentNow(establishmentId: string) {
  const employees = await prisma.employee.findMany({ where: { establishmentId, isActive: true }, select: { id: true, firstName: true, lastName: true, jobTitle: true } });
  const out: { id: string; firstName: string; lastName: string; jobTitle: string | null; state: ClockState; since: Date | null; workedMs: number }[] = [];
  for (const e of employees) {
    const st = await clockState(e.id);
    if (st.state !== "OUT") out.push({ ...e, state: st.state, since: st.entries.find((x) => x.kind === "CLOCK_IN")?.at ?? null, workedMs: st.workedMs });
  }
  return out;
}

export async function listEntries(establishmentId: string, from: Date, to: Date, employeeId?: string) {
  return prisma.timeEntry.findMany({ where: { establishmentId, at: { gte: from, lt: to }, ...(employeeId ? { employeeId } : {}) }, orderBy: { at: "asc" }, include: { employee: { select: { id: true, firstName: true, lastName: true } } } });
}

/** Correction manager d'un pointage (heure) ou ajout manuel ; tracé dans l'audit. */
export async function upsertEntry(actor: Actor, input: { id?: string; employeeId?: string; kind?: TimeEntryKind; at: string; reason: string }) {
  if (input.id) {
    const existing = await prisma.timeEntry.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Pointage introuvable");
    const row = await prisma.timeEntry.update({ where: { id: input.id }, data: { at: new Date(input.at), ...(input.kind ? { kind: input.kind } : {}) } });
    await audit({ ...actor, action: "time_entry.correct", entityType: "time_entry", entityId: row.id, oldValue: { at: existing.at, kind: existing.kind }, newValue: { at: row.at, kind: row.kind }, reason: input.reason });
    return row;
  }
  if (!input.employeeId || !input.kind) throw new ApiError(400, "MISSING", "Employé et type requis");
  const emp = await prisma.employee.findFirst({ where: { id: input.employeeId, establishmentId: actor.establishmentId } });
  if (!emp) throw new ApiError(404, "NOT_FOUND", "Employé introuvable");
  const row = await prisma.timeEntry.create({ data: { establishmentId: actor.establishmentId, employeeId: input.employeeId, kind: input.kind, at: new Date(input.at) } });
  await audit({ ...actor, action: "time_entry.manual", entityType: "time_entry", entityId: row.id, newValue: { at: row.at, kind: row.kind, employee: `${emp.firstName} ${emp.lastName}` }, reason: input.reason });
  return row;
}

export async function deleteEntry(actor: Actor, id: string, reason: string) {
  const existing = await prisma.timeEntry.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Pointage introuvable");
  await prisma.timeEntry.delete({ where: { id } });
  await audit({ ...actor, action: "time_entry.delete", entityType: "time_entry", entityId: id, oldValue: { at: existing.at, kind: existing.kind }, reason });
}

// ------------------------------------------------------------------ Heures et coût
/** Calcule les heures travaillées / de pause à partir d'une séquence de pointages (bornée à la période). */
export function computeHours(entries: { kind: TimeEntryKind; at: Date }[], periodEnd: Date) {
  let state: ClockState = "OUT", inAt: Date | null = null, breakAt: Date | null = null, workedMs = 0, breakMs = 0, sessions = 0;
  for (const e of entries) {
    if (e.kind === "CLOCK_IN") { if (state === "IN" && inAt) workedMs += e.at.getTime() - inAt.getTime(); state = "IN"; inAt = e.at; breakAt = null; sessions++; }
    else if (e.kind === "BREAK_START" && state === "IN" && inAt) { workedMs += e.at.getTime() - inAt.getTime(); state = "BREAK"; breakAt = e.at; inAt = null; }
    else if (e.kind === "BREAK_END" && state === "BREAK" && breakAt) { breakMs += e.at.getTime() - breakAt.getTime(); state = "IN"; inAt = e.at; breakAt = null; }
    else if (e.kind === "CLOCK_OUT" && state !== "OUT") { if (state === "IN" && inAt) workedMs += e.at.getTime() - inAt.getTime(); if (state === "BREAK" && breakAt) breakMs += e.at.getTime() - breakAt.getTime(); state = "OUT"; inAt = null; breakAt = null; }
  }
  // Session encore ouverte : comptée jusqu'à la fin de période (ou maintenant)
  const end = Math.min(periodEnd.getTime(), Date.now());
  if (state === "IN" && inAt) workedMs += Math.max(0, end - inAt.getTime());
  if (state === "BREAK" && breakAt) breakMs += Math.max(0, end - breakAt.getTime());
  return { workedMs, breakMs, sessions, open: state !== "OUT" };
}

export async function staffSummary(establishmentId: string, fromDay: string, toDay: string, timezone: string) {
  const from = startOfLocalDay(fromDay, timezone), to = endOfLocalDay(toDay, timezone);
  const [employees, entries, shifts, revenue] = await Promise.all([
    prisma.employee.findMany({ where: { establishmentId, isActive: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }] }),
    prisma.timeEntry.findMany({ where: { establishmentId, at: { gte: from, lt: to } }, orderBy: { at: "asc" } }),
    prisma.shift.findMany({ where: { establishmentId, startsAt: { gte: from, lt: to } } }),
    prisma.order.aggregate({ where: { establishmentId, status: "PAID", closedAt: { gte: from, lt: to } }, _sum: { total: true, taxTotal: true } }),
  ]);
  const rows = employees.map((e) => {
    const mine = entries.filter((x) => x.employeeId === e.id);
    const h = computeHours(mine, to);
    const hours = Math.round((h.workedMs / 3600_000) * 100) / 100;
    const breakHours = Math.round((h.breakMs / 3600_000) * 100) / 100;
    const planned = Math.round((shifts.filter((s) => s.employeeId === e.id).reduce((a, s) => a + (s.endsAt.getTime() - s.startsAt.getTime()), 0) / 3600_000) * 100) / 100;
    return { id: e.id, firstName: e.firstName, lastName: e.lastName, jobTitle: e.jobTitle, hourlyCost: e.hourlyCost, hours, breakHours, sessions: h.sessions, open: h.open, plannedHours: planned, variance: Math.round((hours - planned) * 100) / 100, cost: Math.round(hours * (e.hourlyCost ?? 0)) };
  });
  const revenueTtc = revenue._sum.total ?? 0;
  const revenueHt = revenueTtc - (revenue._sum.taxTotal ?? 0);
  const totalCost = rows.reduce((a, r) => a + r.cost, 0);
  const totalHours = Math.round(rows.reduce((a, r) => a + r.hours, 0) * 100) / 100;
  return { from: fromDay, to: toDay, rows, totalHours, totalPlannedHours: Math.round(rows.reduce((a, r) => a + r.plannedHours, 0) * 100) / 100, totalCost, revenueHt, laborCostPct: revenueHt > 0 ? Math.round((totalCost / revenueHt) * 1000) / 10 : null, revenuePerHour: totalHours > 0 ? Math.round(revenueHt / totalHours) : null };
}
