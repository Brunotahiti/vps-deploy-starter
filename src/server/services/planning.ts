import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { addDays, endOfLocalDay, localDay, startOfLocalDay, zonedInputToDate } from "@/lib/dates";
import type { Actor } from "./orders";
import type { AbsenceKind, Prisma } from "@/generated/prisma/client";

/**
 * Planning saisi une seule fois : la « semaine type » (employé, jour, heures) remplit toute seule chaque nouvelle
 * semaine. Le gérant ne touche ensuite qu'aux exceptions : congés, remplacements, service déplacé.
 *
 * - Une semaine est remplie une fois (table planning_weeks) : un service supprimé à la main ne revient pas.
 * - Modifier la semaine type met à jour les services à venir qui n'ont pas été retouchés à la main.
 * - Un congé ne supprime rien : les services de l'employé absent apparaissent « à remplacer ».
 */

type Db = Prisma.TransactionClient | typeof prisma;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_WEEKS = 60;
export const ABSENCE_LABEL: Record<AbsenceKind, string> = { LEAVE: "Congés", SICK: "Maladie", OTHER: "Absence" };

/** Jour « AAAA-MM-JJ » ↔ colonne DATE (minuit UTC) */
export const dbDay = (day: string) => new Date(`${day}T00:00:00.000Z`);
export const dayOfDb = (d: Date) => d.toISOString().slice(0, 10);
/** 0 = lundi … 6 = dimanche */
export function weekdayOf(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}
export const mondayOf = (day: string) => addDays(day, -weekdayOf(day));

async function timezoneOf(establishmentId: string) {
  const e = await prisma.establishment.findUnique({ where: { id: establishmentId }, select: { timezone: true } });
  return e?.timezone ?? "Pacific/Tahiti";
}

/** Créneau réel d'une ligne de semaine type un jour donné (fin avant le début = le lendemain). */
export function occurrence(t: { startTime: string; endTime: string }, day: string, timezone: string) {
  const startsAt = zonedInputToDate(`${day}T${t.startTime}`, timezone);
  const endDay = t.endTime <= t.startTime ? addDays(day, 1) : day;
  return { startsAt, endsAt: zonedInputToDate(`${endDay}T${t.endTime}`, timezone) };
}

function assertTimes(startTime: string, endTime: string) {
  if (!TIME.test(startTime) || !TIME.test(endTime)) throw new ApiError(400, "BAD_TIME", "Heure invalide (format HH:MM)");
  const occ = occurrence({ startTime, endTime }, "2026-01-05", "UTC");
  if (occ.endsAt.getTime() - occ.startsAt.getTime() > 16 * 3600_000) throw new ApiError(400, "BAD_RANGE", "Un service ne peut pas dépasser 16 h");
}

/**
 * Ajoute à une semaine les services de la semaine type qui manquent : jamais en double (une ligne = un service par
 * semaine, et pas de chevauchement avec un service déjà prévu pour l'employé), jamais avant le début de validité.
 */
async function fillWeek(db: Db, establishmentId: string, monday: string, timezone: string, opts: { templateIds?: string[]; notBefore?: Date } = {}) {
  const templates = await db.shiftTemplate.findMany({ where: { establishmentId, employee: { isActive: true }, ...(opts.templateIds ? { id: { in: opts.templateIds } } : {}) } });
  if (!templates.length) return 0;
  const from = startOfLocalDay(monday, timezone), to = endOfLocalDay(addDays(monday, 6), timezone);
  const existing = await db.shift.findMany({ where: { establishmentId, startsAt: { gte: new Date(from.getTime() - 86_400_000), lt: new Date(to.getTime() + 86_400_000) } }, select: { employeeId: true, templateId: true, startsAt: true, endsAt: true } });
  let created = 0;
  for (const t of templates) {
    const day = addDays(monday, t.weekday);
    if (day < dayOfDb(t.validFrom)) continue;
    const occ = occurrence(t, day, timezone);
    if (opts.notBefore && occ.startsAt <= opts.notBefore) continue;
    const dayStart = startOfLocalDay(day, timezone), dayEnd = endOfLocalDay(day, timezone);
    if (existing.some((s) => s.templateId === t.id && s.startsAt >= dayStart && s.startsAt < dayEnd)) continue;
    if (existing.some((s) => s.employeeId === t.employeeId && s.startsAt < occ.endsAt && s.endsAt > occ.startsAt)) continue;
    await db.shift.create({ data: { establishmentId, employeeId: t.employeeId, templateId: t.id, startsAt: occ.startsAt, endsAt: occ.endsAt, notes: t.notes } });
    existing.push({ employeeId: t.employeeId, templateId: t.id, ...occ });
    created++;
  }
  return created;
}

/** Remplit, une seule fois chacune, les semaines de la période à partir de la semaine type. */
export async function ensurePlanningWeeks(establishmentId: string, fromDay: string, toDay: string, timezone?: string) {
  if (!(await prisma.shiftTemplate.count({ where: { establishmentId } }))) return 0;
  const tz = timezone ?? (await timezoneOf(establishmentId));
  let created = 0;
  for (let monday = mondayOf(fromDay), n = 0; monday <= toDay && n < MAX_WEEKS; monday = addDays(monday, 7), n++) {
    const week = monday;
    created += await prisma.$transaction(async (tx) => {
      // Le marqueur d'abord : deux écrans qui ouvrent la même semaine ne la remplissent pas deux fois
      const mark = await tx.planningWeek.createMany({ data: [{ establishmentId, monday: dbDay(week) }], skipDuplicates: true });
      return mark.count ? fillWeek(tx, establishmentId, week, tz) : 0;
    });
  }
  return created;
}

/** Après un changement de la semaine type : complète les semaines déjà remplies, pour les services à venir seulement. */
async function refreshFutureWeeks(tx: Db, establishmentId: string, timezone: string, templateIds?: string[]) {
  const thisMonday = mondayOf(localDay(new Date(), timezone));
  const weeks = await tx.planningWeek.findMany({ where: { establishmentId, monday: { gte: dbDay(thisMonday) } }, select: { monday: true } });
  for (const w of weeks) await fillWeek(tx, establishmentId, dayOfDb(w.monday), timezone, { templateIds, notBefore: new Date() });
}

// ------------------------------------------------------------------ Semaine type
const templateInclude = { employee: { select: { id: true, firstName: true, lastName: true, jobTitle: true } } } as const;

export async function listShiftTemplates(establishmentId: string) {
  return prisma.shiftTemplate.findMany({ where: { establishmentId, employee: { isActive: true } }, orderBy: [{ weekday: "asc" }, { startTime: "asc" }], include: templateInclude });
}

export async function upsertShiftTemplate(actor: Actor, input: { id?: string; employeeId: string; weekday: number; startTime: string; endTime: string; notes?: string | null }) {
  assertTimes(input.startTime, input.endTime);
  if (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) throw new ApiError(400, "BAD_DAY", "Jour invalide");
  const emp = await prisma.employee.findFirst({ where: { id: input.employeeId, establishmentId: actor.establishmentId, isActive: true } });
  if (!emp) throw new ApiError(404, "NOT_FOUND", "Employé introuvable");
  const tz = await timezoneOf(actor.establishmentId);
  const today = dbDay(localDay(new Date(), tz));
  const data = { employeeId: input.employeeId, weekday: input.weekday, startTime: input.startTime, endTime: input.endTime, notes: input.notes?.trim() || null, validFrom: today };
  const row = await prisma.$transaction(async (tx) => {
    let row;
    if (input.id) {
      const before = await tx.shiftTemplate.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
      if (!before) throw new ApiError(404, "NOT_FOUND", "Ligne de la semaine type introuvable");
      // Les services à venir non retouchés suivent la nouvelle version ; le passé et les retouches restent
      await tx.shift.deleteMany({ where: { templateId: input.id, isEdited: false, startsAt: { gt: new Date() } } });
      row = await tx.shiftTemplate.update({ where: { id: input.id }, data, include: templateInclude });
    } else {
      row = await tx.shiftTemplate.create({ data: { establishmentId: actor.establishmentId, ...data }, include: templateInclude });
    }
    await refreshFutureWeeks(tx, actor.establishmentId, tz, [row.id]);
    return row;
  });
  await audit({ ...actor, action: input.id ? "planning.template.update" : "planning.template.create", entityType: "shift_template", entityId: row.id, newValue: { employee: `${row.employee.firstName} ${row.employee.lastName}`, weekday: row.weekday, startTime: row.startTime, endTime: row.endTime } });
  return row;
}

export async function deleteShiftTemplate(actor: Actor, id: string) {
  const before = await prisma.shiftTemplate.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!before) throw new ApiError(404, "NOT_FOUND", "Ligne de la semaine type introuvable");
  const removed = await prisma.$transaction(async (tx) => {
    const r = await tx.shift.deleteMany({ where: { templateId: id, isEdited: false, startsAt: { gt: new Date() } } });
    await tx.shiftTemplate.delete({ where: { id } });
    return r.count;
  });
  await audit({ ...actor, action: "planning.template.delete", entityType: "shift_template", entityId: id, oldValue: before });
  return { removedShifts: removed };
}

/**
 * « Garder cette semaine comme semaine type » : la semaine affichée devient le modèle des suivantes.
 * Ses services y sont rattachés (pas de doublon) ; les remplacements reprennent l'employé prévu au départ.
 */
export async function saveWeekAsTemplate(actor: Actor, monday: string) {
  if (weekdayOf(monday) !== 0) throw new ApiError(400, "BAD_DAY", "La semaine doit commencer un lundi");
  const tz = await timezoneOf(actor.establishmentId);
  const from = startOfLocalDay(monday, tz), to = endOfLocalDay(addDays(monday, 6), tz);
  const shifts = await prisma.shift.findMany({ where: { establishmentId: actor.establishmentId, startsAt: { gte: from, lt: to }, employee: { isActive: true } }, orderBy: { startsAt: "asc" } });
  if (!shifts.length) throw new ApiError(400, "EMPTY_WEEK", "Cette semaine est vide : ajoutez d'abord les services de vos employés");
  const fmt = (d: Date) => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(d); return p; };
  const count = await prisma.$transaction(async (tx) => {
    const old = await tx.shiftTemplate.findMany({ where: { establishmentId: actor.establishmentId }, select: { id: true } });
    await tx.shift.deleteMany({ where: { templateId: { in: old.map((o) => o.id) }, isEdited: false, startsAt: { gte: to } } });
    await tx.shiftTemplate.deleteMany({ where: { establishmentId: actor.establishmentId } });
    for (const s of shifts) {
      const t = await tx.shiftTemplate.create({ data: { establishmentId: actor.establishmentId, employeeId: s.replacesEmployeeId ?? s.employeeId, weekday: weekdayOf(localDay(s.startsAt, tz)), startTime: fmt(s.startsAt), endTime: fmt(s.endsAt), notes: s.notes, validFrom: dbDay(monday) } });
      await tx.shift.update({ where: { id: s.id }, data: { templateId: t.id } });
    }
    await tx.planningWeek.createMany({ data: [{ establishmentId: actor.establishmentId, monday: dbDay(monday) }], skipDuplicates: true });
    await refreshFutureWeeks(tx, actor.establishmentId, tz);
    return shifts.length;
  });
  await audit({ ...actor, action: "planning.template.from_week", entityType: "establishment", entityId: actor.establishmentId, newValue: { monday, lines: count } });
  return { lines: count };
}

// ------------------------------------------------------------------ Congés et absences
const absenceInclude = { employee: { select: { id: true, firstName: true, lastName: true } } } as const;

export async function listAbsences(establishmentId: string, fromDay: string, toDay: string) {
  return prisma.staffAbsence.findMany({ where: { establishmentId, startsOn: { lte: dbDay(toDay) }, endsOn: { gte: dbDay(fromDay) } }, orderBy: [{ startsOn: "asc" }], include: absenceInclude });
}

/** Absences de la période, par employé : pour savoir si un service tombe pendant un congé. */
export async function absenceLookup(establishmentId: string, fromDay: string, toDay: string) {
  const rows = await prisma.staffAbsence.findMany({ where: { establishmentId, startsOn: { lte: dbDay(toDay) }, endsOn: { gte: dbDay(fromDay) } }, select: { employeeId: true, startsOn: true, endsOn: true, kind: true } });
  return (employeeId: string, day: string) => rows.find((a) => a.employeeId === employeeId && dayOfDb(a.startsOn) <= day && day <= dayOfDb(a.endsOn)) ?? null;
}

export async function upsertAbsence(actor: Actor, input: { id?: string; employeeId: string; startsOn: string; endsOn: string; kind?: AbsenceKind; notes?: string | null }) {
  if (input.endsOn < input.startsOn) throw new ApiError(400, "BAD_RANGE", "La date de fin doit suivre la date de début");
  const emp = await prisma.employee.findFirst({ where: { id: input.employeeId, establishmentId: actor.establishmentId } });
  if (!emp) throw new ApiError(404, "NOT_FOUND", "Employé introuvable");
  const data = { employeeId: input.employeeId, startsOn: dbDay(input.startsOn), endsOn: dbDay(input.endsOn), kind: input.kind ?? "LEAVE", notes: input.notes?.trim() || null };
  let row;
  if (input.id) {
    const before = await prisma.staffAbsence.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!before) throw new ApiError(404, "NOT_FOUND", "Absence introuvable");
    row = await prisma.staffAbsence.update({ where: { id: input.id }, data, include: absenceInclude });
  } else {
    row = await prisma.staffAbsence.create({ data: { establishmentId: actor.establishmentId, ...data }, include: absenceInclude });
  }
  const tz = await timezoneOf(actor.establishmentId);
  // La semaine type doit être posée sur la période pour montrer les services à remplacer
  await ensurePlanningWeeks(actor.establishmentId, input.startsOn, input.endsOn, tz);
  const toCover = await prisma.shift.count({ where: { establishmentId: actor.establishmentId, employeeId: input.employeeId, startsAt: { gte: startOfLocalDay(input.startsOn, tz), lt: endOfLocalDay(input.endsOn, tz) } } });
  await audit({ ...actor, action: input.id ? "planning.absence.update" : "planning.absence.create", entityType: "staff_absence", entityId: row.id, newValue: { employee: `${emp.firstName} ${emp.lastName}`, startsOn: input.startsOn, endsOn: input.endsOn, kind: data.kind } });
  return { ...row, shiftsToCover: toCover };
}

export async function deleteAbsence(actor: Actor, id: string) {
  const before = await prisma.staffAbsence.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!before) throw new ApiError(404, "NOT_FOUND", "Absence introuvable");
  await prisma.staffAbsence.delete({ where: { id } });
  await audit({ ...actor, action: "planning.absence.delete", entityType: "staff_absence", entityId: id, oldValue: before });
}
