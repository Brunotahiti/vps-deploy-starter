import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { addDays, endOfLocalDay, localDay, startOfLocalDay } from "@/lib/dates";
import type { Actor } from "@/server/services/orders";

/**
 * Hygiène & HACCP (option « hygiene ») : relevés de température, plan de nettoyage, traçabilité (réceptions,
 * préparations, DLC) et registre pour un contrôle sanitaire. Températures stockées en dixièmes de °C.
 */

export type EquipmentKind = "FRIDGE" | "FREEZER" | "HOT" | "OTHER";
export type CleaningFrequency = "DAILY" | "WEEKLY" | "MONTHLY";

/** Plages usuelles proposées à la création d'un équipement (toujours modifiables par le restaurant). */
export const KIND_PRESETS: Record<EquipmentKind, { label: string; min: number; max: number }> = {
  FRIDGE: { label: "Réfrigérateur", min: 0, max: 4 },
  FREEZER: { label: "Congélateur", min: -30, max: -18 },
  HOT: { label: "Maintien au chaud", min: 63, max: 100 },
  OTHER: { label: "Autre", min: 0, max: 10 },
};

/** Plan de départ, à adapter : deux équipements et les nettoyages courants d'une cuisine et d'une salle. */
const STARTER_EQUIPMENT: { name: string; kind: EquipmentKind }[] = [
  { name: "Réfrigérateur cuisine", kind: "FRIDGE" },
  { name: "Congélateur", kind: "FREEZER" },
];
const STARTER_TASKS: { name: string; area: string; frequency: CleaningFrequency }[] = [
  { name: "Plans de travail et planches", area: "Cuisine", frequency: "DAILY" },
  { name: "Sols de la cuisine", area: "Cuisine", frequency: "DAILY" },
  { name: "Plonge et éviers", area: "Plonge", frequency: "DAILY" },
  { name: "Poubelles et zone déchets", area: "Cuisine", frequency: "DAILY" },
  { name: "Tables et chaises", area: "Salle", frequency: "DAILY" },
  { name: "Toilettes", area: "Salle", frequency: "DAILY" },
  { name: "Intérieur des réfrigérateurs", area: "Cuisine", frequency: "WEEKLY" },
  { name: "Hotte et filtres", area: "Cuisine", frequency: "WEEKLY" },
  { name: "Dégivrage et nettoyage du congélateur", area: "Cuisine", frequency: "MONTHLY" },
];

/** Relevés : un le matin (avant 14 h), un le soir. */
const EVENING_FROM_HOUR = 14;

export const toTenths = (celsius: number) => Math.round(celsius * 10);
export const fromTenths = (t: number) => t / 10;
/** « 7,5 °C » */
export const degrees = (celsius: number) => `${celsius.toLocaleString("fr-FR")} °C`;

type Person = { firstName: string; lastName: string; displayName: string | null } | null;
const personName = (u: Person) => (u ? u.displayName || `${u.firstName} ${u.lastName.charAt(0)}.`.trim() : null);
const personSelect = { select: { firstName: true, lastName: true, displayName: true } } as const;

function localHour(date: Date, timeZone: string) {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(date));
}
/** Premier jour de la semaine (lundi) et du mois, à l'heure locale. */
function weekStartDay(day: string) {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}
const monthStartDay = (day: string) => `${day.slice(0, 8)}01`;

async function timezoneOf(establishmentId: string) {
  return (await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { timezone: true } })).timezone;
}

// ─── Plan de départ ───

export async function setupStarterPlan(actor: Actor) {
  const [eq, tasks] = await Promise.all([
    prisma.hygieneEquipment.count({ where: { establishmentId: actor.establishmentId } }),
    prisma.cleaningTask.count({ where: { establishmentId: actor.establishmentId } }),
  ]);
  if (eq === 0) {
    await prisma.hygieneEquipment.createMany({ data: STARTER_EQUIPMENT.map((e, i) => ({ establishmentId: actor.establishmentId, name: e.name, kind: e.kind, minTemp: toTenths(KIND_PRESETS[e.kind].min), maxTemp: toTenths(KIND_PRESETS[e.kind].max), sortOrder: i })) });
  }
  if (tasks === 0) {
    await prisma.cleaningTask.createMany({ data: STARTER_TASKS.map((t, i) => ({ establishmentId: actor.establishmentId, ...t, sortOrder: i })) });
  }
  await audit({ ...actor, action: "hygiene.setup", entityType: "establishment", entityId: actor.establishmentId });
  return { equipment: eq === 0 ? STARTER_EQUIPMENT.length : 0, tasks: tasks === 0 ? STARTER_TASKS.length : 0 };
}

// ─── Équipements et relevés ───

export async function listEquipment(establishmentId: string, includeInactive = false) {
  const rows = await prisma.hygieneEquipment.findMany({ where: { establishmentId, ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return rows.map((e) => ({ id: e.id, name: e.name, kind: e.kind as EquipmentKind, minTemp: fromTenths(e.minTemp), maxTemp: fromTenths(e.maxTemp), isActive: e.isActive }));
}

export async function upsertEquipment(actor: Actor, input: { id?: string; name: string; kind: EquipmentKind; minTemp: number; maxTemp: number; isActive?: boolean }) {
  const data = { name: input.name, kind: input.kind, minTemp: toTenths(input.minTemp), maxTemp: toTenths(input.maxTemp), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
  if (input.id) {
    const old = await prisma.hygieneEquipment.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!old) throw new ApiError(404, "NOT_FOUND", "Équipement introuvable");
    const e = await prisma.hygieneEquipment.update({ where: { id: old.id }, data });
    await audit({ ...actor, action: "hygiene.equipment.update", entityType: "hygiene_equipment", entityId: e.id, oldValue: { name: old.name, minTemp: old.minTemp, maxTemp: old.maxTemp }, newValue: data });
    return e;
  }
  const count = await prisma.hygieneEquipment.count({ where: { establishmentId: actor.establishmentId } });
  const e = await prisma.hygieneEquipment.create({ data: { ...data, establishmentId: actor.establishmentId, sortOrder: count } });
  await audit({ ...actor, action: "hygiene.equipment.create", entityType: "hygiene_equipment", entityId: e.id, newValue: data });
  return e;
}

/** Retiré de la liste, ses relevés restent dans le registre. */
export async function archiveEquipment(actor: Actor, id: string) {
  const e = await prisma.hygieneEquipment.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!e) throw new ApiError(404, "NOT_FOUND", "Équipement introuvable");
  await prisma.hygieneEquipment.update({ where: { id }, data: { isActive: false } });
  await audit({ ...actor, action: "hygiene.equipment.archive", entityType: "hygiene_equipment", entityId: id });
}

export async function recordReading(actor: Actor, input: { equipmentId: string; value: number; correctiveAction?: string | null }, now = new Date()) {
  const e = await prisma.hygieneEquipment.findFirst({ where: { id: input.equipmentId, establishmentId: actor.establishmentId, isActive: true } });
  if (!e) throw new ApiError(404, "NOT_FOUND", "Équipement introuvable");
  const value = toTenths(input.value);
  const compliant = value >= e.minTemp && value <= e.maxTemp;
  const action = input.correctiveAction?.trim() || null;
  if (!compliant && !action) {
    throw new ApiError(400, "CORRECTIVE_ACTION_REQUIRED", `${degrees(fromTenths(value))} : hors limites pour « ${e.name} » (${fromTenths(e.minTemp).toLocaleString("fr-FR")} à ${degrees(fromTenths(e.maxTemp))}). Indiquez ce qui a été fait.`, { min: fromTenths(e.minTemp), max: fromTenths(e.maxTemp) });
  }
  return prisma.temperatureReading.create({ data: { establishmentId: actor.establishmentId, equipmentId: e.id, value, minTemp: e.minTemp, maxTemp: e.maxTemp, compliant, correctiveAction: compliant ? null : action, userId: actor.userId, takenAt: now } });
}

export async function listReadings(establishmentId: string, from: Date, to: Date) {
  const rows = await prisma.temperatureReading.findMany({
    where: { establishmentId, takenAt: { gte: from, lte: to } },
    include: { equipment: { select: { name: true } }, user: personSelect },
    orderBy: { takenAt: "desc" }, take: 2000,
  });
  return rows.map((r) => ({ id: r.id, equipmentId: r.equipmentId, equipment: r.equipment.name, min: fromTenths(r.minTemp), max: fromTenths(r.maxTemp), value: fromTenths(r.value), compliant: r.compliant, correctiveAction: r.correctiveAction, takenAt: r.takenAt.toISOString(), by: personName(r.user) }));
}

// ─── Plan de nettoyage ───

export async function listCleaningTasks(establishmentId: string, includeInactive = false) {
  return prisma.cleaningTask.findMany({ where: { establishmentId, ...(includeInactive ? {} : { isActive: true }) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, area: true, frequency: true, instructions: true, isActive: true } });
}

export async function upsertCleaningTask(actor: Actor, input: { id?: string; name: string; area?: string | null; frequency: CleaningFrequency; instructions?: string | null; isActive?: boolean }) {
  const data = { name: input.name, area: input.area || null, frequency: input.frequency, instructions: input.instructions || null, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) };
  if (input.id) {
    const old = await prisma.cleaningTask.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!old) throw new ApiError(404, "NOT_FOUND", "Tâche introuvable");
    return prisma.cleaningTask.update({ where: { id: old.id }, data });
  }
  const count = await prisma.cleaningTask.count({ where: { establishmentId: actor.establishmentId } });
  return prisma.cleaningTask.create({ data: { ...data, establishmentId: actor.establishmentId, sortOrder: count } });
}

export async function archiveCleaningTask(actor: Actor, id: string) {
  const t = await prisma.cleaningTask.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!t) throw new ApiError(404, "NOT_FOUND", "Tâche introuvable");
  await prisma.cleaningTask.update({ where: { id }, data: { isActive: false } });
}

export async function markCleaningDone(actor: Actor, taskId: string, note?: string | null, now = new Date()) {
  const t = await prisma.cleaningTask.findFirst({ where: { id: taskId, establishmentId: actor.establishmentId, isActive: true } });
  if (!t) throw new ApiError(404, "NOT_FOUND", "Tâche introuvable");
  return prisma.cleaningLog.create({ data: { establishmentId: actor.establishmentId, taskId: t.id, userId: actor.userId, note: note?.trim() || null, doneAt: now } });
}

/** Début de la période en cours d'une tâche : aujourd'hui, depuis lundi ou depuis le 1er du mois. */
function periodStart(frequency: string, day: string, tz: string) {
  return startOfLocalDay(frequency === "WEEKLY" ? weekStartDay(day) : frequency === "MONTHLY" ? monthStartDay(day) : day, tz);
}

// ─── Traçabilité ───

type TraceInput = { kind: "RECEPTION" | "PREPARATION"; name: string; supplierName?: string | null; lotNumber?: string | null; quantity?: string | null; temperature?: number | null; compliant?: boolean; issue?: string | null; useBy?: string | null };

export async function createTrace(actor: Actor, input: TraceInput, now = new Date()) {
  const tz = await timezoneOf(actor.establishmentId);
  const compliant = input.compliant ?? true;
  const issue = input.issue?.trim() || null;
  if (!compliant && !issue) throw new ApiError(400, "ISSUE_REQUIRED", "Non conforme : indiquez le problème et la suite donnée (refus, retour fournisseur…)");
  if (input.useBy && input.useBy < localDay(now, tz) && input.kind === "PREPARATION") throw new ApiError(400, "BAD_DATE", "La date limite d'une préparation ne peut pas être déjà passée");
  return prisma.traceRecord.create({
    data: {
      establishmentId: actor.establishmentId, kind: input.kind, name: input.name, supplierName: input.kind === "RECEPTION" ? input.supplierName || null : null,
      lotNumber: input.lotNumber || null, quantity: input.quantity || null, temperature: input.temperature === null || input.temperature === undefined ? null : toTenths(input.temperature),
      compliant, issue: compliant ? null : issue, madeAt: now, useBy: input.useBy ? endOfLocalDay(input.useBy, tz) : null, userId: actor.userId,
      // Marchandise refusée à la livraison : rien à suivre en stock
      ...(input.kind === "RECEPTION" && !compliant ? { closedAt: now, closedReason: "DISCARDED" } : {}),
    },
  });
}

export async function closeTrace(actor: Actor, id: string, reason: "USED" | "DISCARDED", now = new Date()) {
  const r = await prisma.traceRecord.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!r) throw new ApiError(404, "NOT_FOUND", "Enregistrement introuvable");
  if (r.closedAt) return r;
  return prisma.traceRecord.update({ where: { id }, data: { closedAt: now, closedReason: reason } });
}

const traceView = (r: { id: string; kind: string; name: string; supplierName: string | null; lotNumber: string | null; quantity: string | null; temperature: number | null; compliant: boolean; issue: string | null; madeAt: Date; useBy: Date | null; closedAt: Date | null; closedReason: string | null; user: Person }, now: Date) => ({
  id: r.id, kind: r.kind as TraceInput["kind"], name: r.name, supplierName: r.supplierName, lotNumber: r.lotNumber, quantity: r.quantity,
  temperature: r.temperature === null ? null : fromTenths(r.temperature), compliant: r.compliant, issue: r.issue, madeAt: r.madeAt.toISOString(),
  useBy: r.useBy?.toISOString() ?? null, expired: !!r.useBy && !r.closedAt && r.useBy < now, closedAt: r.closedAt?.toISOString() ?? null, closedReason: r.closedReason, by: personName(r.user),
});

/** Produits et préparations en cours (non utilisés ni jetés) et ce qui a été enregistré ces derniers jours. */
export async function listTrace(establishmentId: string, days = 14, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await prisma.traceRecord.findMany({
    where: { establishmentId, OR: [{ closedAt: null }, { madeAt: { gte: since } }] },
    include: { user: personSelect }, orderBy: [{ madeAt: "desc" }], take: 500,
  });
  return rows.map((r) => traceView(r, now));
}

export async function getTrace(establishmentId: string, id: string) {
  const r = await prisma.traceRecord.findFirst({ where: { id, establishmentId }, include: { user: personSelect } });
  if (!r) throw new ApiError(404, "NOT_FOUND", "Enregistrement introuvable");
  return traceView(r, new Date());
}

// ─── Aujourd'hui : ce qu'il reste à faire ───

export async function hygieneToday(establishmentId: string, now = new Date()) {
  const tz = await timezoneOf(establishmentId);
  const day = localDay(now, tz);
  const dayStart = startOfLocalDay(day, tz);
  const slot: "MORNING" | "EVENING" = localHour(now, tz) < EVENING_FROM_HOUR ? "MORNING" : "EVENING";
  const monthStart = startOfLocalDay(monthStartDay(day), tz);
  const soon = endOfLocalDay(addDays(day, 1), tz);

  const [equipment, readings, tasks, logs, expiring, issues] = await Promise.all([
    prisma.hygieneEquipment.findMany({ where: { establishmentId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.temperatureReading.findMany({ where: { establishmentId, takenAt: { gte: new Date(dayStart.getTime() - 7 * 86_400_000) } }, include: { user: personSelect }, orderBy: { takenAt: "desc" } }),
    prisma.cleaningTask.findMany({ where: { establishmentId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    // Du début du mois (ou de la semaine, si elle a commencé le mois précédent) : couvre toutes les fréquences
    prisma.cleaningLog.findMany({ where: { establishmentId, doneAt: { gte: new Date(Math.min(monthStart.getTime(), startOfLocalDay(weekStartDay(day), tz).getTime())) } }, include: { user: personSelect }, orderBy: { doneAt: "desc" } }),
    prisma.traceRecord.findMany({ where: { establishmentId, closedAt: null, useBy: { not: null, lte: soon } }, include: { user: personSelect }, orderBy: { useBy: "asc" } }),
    prisma.temperatureReading.count({ where: { establishmentId, compliant: false, takenAt: { gte: dayStart } } }),
  ]);

  const eqRows = equipment.map((e) => {
    const mine = readings.filter((r) => r.equipmentId === e.id);
    const today = mine.filter((r) => r.takenAt >= dayStart);
    const morning = today.some((r) => localHour(r.takenAt, tz) < EVENING_FROM_HOUR);
    const evening = today.some((r) => localHour(r.takenAt, tz) >= EVENING_FROM_HOUR);
    const last = mine[0];
    return {
      id: e.id, name: e.name, kind: e.kind as EquipmentKind, minTemp: fromTenths(e.minTemp), maxTemp: fromTenths(e.maxTemp), morning, evening,
      due: slot === "MORNING" ? !morning : !evening,
      last: last ? { value: fromTenths(last.value), compliant: last.compliant, takenAt: last.takenAt.toISOString(), by: personName(last.user) } : null,
    };
  });
  const taskRows = tasks.map((t) => {
    const start = periodStart(t.frequency, day, tz);
    const last = logs.find((l) => l.taskId === t.id);
    return { id: t.id, name: t.name, area: t.area, frequency: t.frequency as CleaningFrequency, instructions: t.instructions, due: !last || last.doneAt < start, lastDoneAt: last?.doneAt.toISOString() ?? null, lastBy: last ? personName(last.user) : null };
  });
  const exp = expiring.map((r) => traceView(r, now));
  return {
    day, slot, setupDone: equipment.length > 0 || tasks.length > 0,
    equipment: eqRows, cleaning: taskRows, expiring: exp,
    counts: { readingsDue: eqRows.filter((e) => e.due).length, cleaningDue: taskRows.filter((t) => t.due).length, expired: exp.filter((r) => r.expired).length, expiringSoon: exp.filter((r) => !r.expired).length, issuesToday: issues },
  };
}

// ─── Registre (contrôle sanitaire) ───

export async function hygieneRegister(establishmentId: string, fromDay: string, toDay: string) {
  const tz = await timezoneOf(establishmentId);
  if (fromDay > toDay) throw new ApiError(400, "BAD_RANGE", "La date de début doit précéder la date de fin");
  if (addDays(fromDay, 92) < toDay) throw new ApiError(400, "BAD_RANGE", "Trois mois au plus par registre");
  const from = startOfLocalDay(fromDay, tz), to = endOfLocalDay(toDay, tz);
  const [readings, cleaning, trace] = await Promise.all([
    listReadings(establishmentId, from, to),
    prisma.cleaningLog.findMany({ where: { establishmentId, doneAt: { gte: from, lte: to } }, include: { task: { select: { name: true, area: true, frequency: true } }, user: personSelect }, orderBy: { doneAt: "asc" } }),
    prisma.traceRecord.findMany({ where: { establishmentId, madeAt: { gte: from, lte: to } }, include: { user: personSelect }, orderBy: { madeAt: "asc" } }),
  ]);
  const now = new Date();
  return {
    from: fromDay, to: toDay, timezone: tz,
    readings: readings.reverse(),
    cleaning: cleaning.map((l) => ({ task: l.task.name, area: l.task.area, frequency: l.task.frequency, doneAt: l.doneAt.toISOString(), by: personName(l.user), note: l.note })),
    trace: trace.map((r) => traceView(r, now)),
    nonConformities: [
      ...readings.filter((r) => !r.compliant).map((r) => ({ at: r.takenAt, what: `${r.equipment} : ${degrees(r.value)} (limites ${r.min.toLocaleString("fr-FR")} à ${degrees(r.max)})`, action: r.correctiveAction ?? "", by: r.by })),
      ...trace.filter((r) => !r.compliant).map((r) => ({ at: r.madeAt.toISOString(), what: `Réception ${r.name}${r.supplierName ? ` (${r.supplierName})` : ""}`, action: r.issue ?? "", by: personName(r.user) })),
    ].sort((a, b) => a.at.localeCompare(b.at)),
  };
}
