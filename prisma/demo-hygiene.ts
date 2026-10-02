/**
 * Restaurant exemple : hygiène & HACCP qui vit avec la démo (relevés matin et soir, nettoyages, traçabilité),
 * sur les 14 derniers jours et jusqu'à l'heure actuelle. Idempotent : ne crée que ce qui manque.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { addDays, localDay, startOfLocalDay } from "../src/lib/dates";
import type { DemoCtx } from "./demo-activity";

const DAYS = 14;
const EQUIPMENT = [
  { name: "Réfrigérateur cuisine", kind: "FRIDGE", minTemp: 0, maxTemp: 40, base: 30 },
  { name: "Chambre froide", kind: "FRIDGE", minTemp: 0, maxTemp: 40, base: 25 },
  { name: "Frigo boissons", kind: "FRIDGE", minTemp: 0, maxTemp: 60, base: 45 },
  { name: "Congélateur", kind: "FREEZER", minTemp: -300, maxTemp: -180, base: -205 },
] as const;
const TASKS = [
  { name: "Plans de travail et planches", area: "Cuisine", frequency: "DAILY" },
  { name: "Sols de la cuisine", area: "Cuisine", frequency: "DAILY" },
  { name: "Plonge et éviers", area: "Plonge", frequency: "DAILY" },
  { name: "Poubelles et zone déchets", area: "Cuisine", frequency: "DAILY" },
  { name: "Tables et chaises", area: "Salle", frequency: "DAILY" },
  { name: "Toilettes", area: "Salle", frequency: "DAILY" },
  { name: "Intérieur des réfrigérateurs", area: "Cuisine", frequency: "WEEKLY" },
  { name: "Hotte et filtres", area: "Cuisine", frequency: "WEEKLY" },
  { name: "Dégivrage et nettoyage du congélateur", area: "Cuisine", frequency: "MONTHLY" },
] as const;
const PREPARATIONS = ["Sauce coco", "Poisson cru mariné", "Fond de volaille", "Vinaigrette passion", "Purée de taro", "Crème vanille"];
const RECEPTIONS = [{ name: "Thon rouge", qty: "6 kg", t: 18 }, { name: "Mahi mahi", qty: "4 kg", t: 21 }, { name: "Crevettes", qty: "3 kg", t: 15 }, { name: "Lait de coco", qty: "12 L", t: 38 }, { name: "Poulet fermier", qty: "8 kg", t: 26 }];

/** Heure locale « h:mm » d'un jour → instant */
const at = (day: string, tz: string, h: number, m = 0) => new Date(startOfLocalDay(day, tz).getTime() + (h * 60 + m) * 60_000);
function rng(key: string) {
  let h = 2166136261;
  for (const ch of key) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export async function hygieneDemo(prisma: PrismaClient, ctx: DemoCtx, today: string, now = new Date()) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { options: true } });
  if (!org.options.includes("hygiene")) await prisma.organization.update({ where: { id: ctx.orgId }, data: { options: [...org.options, "hygiene"] } });

  // Plan d'hygiène du restaurant exemple
  if (!(await prisma.hygieneEquipment.count({ where: { establishmentId: ctx.estId } }))) {
    await prisma.hygieneEquipment.createMany({ data: EQUIPMENT.map((e, i) => ({ establishmentId: ctx.estId, name: e.name, kind: e.kind, minTemp: e.minTemp, maxTemp: e.maxTemp, sortOrder: i })) });
  }
  if (!(await prisma.cleaningTask.count({ where: { establishmentId: ctx.estId } }))) {
    await prisma.cleaningTask.createMany({ data: TASKS.map((t, i) => ({ establishmentId: ctx.estId, ...t, sortOrder: i })) });
  }
  const equipment = await prisma.hygieneEquipment.findMany({ where: { establishmentId: ctx.estId, isActive: true } });
  const tasks = await prisma.cleaningTask.findMany({ where: { establishmentId: ctx.estId, isActive: true } });
  const since = startOfLocalDay(addDays(today, -DAYS), ctx.tz);
  const staff = [ctx.managerId, ...ctx.servers];

  // Relevés : matin (8 h 30) et soir (18 h) de chaque équipement, s'ils manquent et que l'heure est passée
  const readings = await prisma.temperatureReading.findMany({ where: { establishmentId: ctx.estId, takenAt: { gte: since } }, select: { equipmentId: true, takenAt: true } });
  const newReadings: { establishmentId: string; equipmentId: string; value: number; minTemp: number; maxTemp: number; compliant: boolean; correctiveAction: string | null; userId: string; takenAt: Date }[] = [];
  for (let d = addDays(today, -DAYS); d <= today; d = addDays(d, 1)) {
    for (const [slot, h, m] of [["matin", 8, 30], ["soir", 18, 0]] as const) {
      const when = at(d, ctx.tz, h, m);
      if (when > now) continue;
      const slotFrom = at(d, ctx.tz, slot === "matin" ? 0 : 14), slotTo = at(d, ctx.tz, slot === "matin" ? 14 : 24);
      equipment.forEach((e, i) => {
        if (readings.some((r) => r.equipmentId === e.id && r.takenAt >= slotFrom && r.takenAt < slotTo)) return;
        const rand = rng(`${d}-${slot}-${e.name}`);
        const base = EQUIPMENT.find((x) => x.name === e.name)?.base ?? Math.round((e.minTemp + e.maxTemp) / 2);
        let value = base + Math.round((rand() - 0.5) * 12);
        let action: string | null = null;
        // Il y a trois jours au soir : le frigo boissons est resté entrouvert, l'équipe a réagi
        if (d === addDays(today, -3) && slot === "soir" && e.name === "Frigo boissons") { value = 72; action = "Porte mal fermée après la livraison : refermée, contrôle refait à 4 °C 30 min plus tard"; }
        value = action ? value : Math.min(e.maxTemp, Math.max(e.minTemp, value));
        newReadings.push({ establishmentId: ctx.estId, equipmentId: e.id, value, minTemp: e.minTemp, maxTemp: e.maxTemp, compliant: !action, correctiveAction: action, userId: staff[Math.floor(rand() * staff.length)], takenAt: new Date(when.getTime() + i * 60_000 + Math.floor(rand() * 8) * 60_000) });
      });
    }
  }
  if (newReadings.length) await prisma.temperatureReading.createMany({ data: newReadings });

  // Nettoyages : quotidiens après le service du soir (22 h 30), hebdomadaires le lundi, mensuels le 1er
  const logs = await prisma.cleaningLog.findMany({ where: { establishmentId: ctx.estId, doneAt: { gte: since } }, select: { taskId: true, doneAt: true } });
  const newLogs: { establishmentId: string; taskId: string; userId: string; doneAt: Date }[] = [];
  for (let d = addDays(today, -DAYS); d <= today; d = addDays(d, 1)) {
    const monday = new Date(`${d}T12:00:00Z`).getUTCDay() === 1;
    for (const t of tasks) {
      const due = t.frequency === "DAILY" || (t.frequency === "WEEKLY" && monday) || (t.frequency === "MONTHLY" && d.endsWith("-01"));
      const when = at(d, ctx.tz, t.frequency === "DAILY" ? 22 : 15, 30);
      if (!due || when > now) continue;
      if (logs.some((l) => l.taskId === t.id && localDay(l.doneAt, ctx.tz) === d)) continue;
      const rand = rng(`${d}-${t.name}`);
      newLogs.push({ establishmentId: ctx.estId, taskId: t.id, userId: staff[Math.floor(rand() * staff.length)], doneAt: new Date(when.getTime() + Math.floor(rand() * 20) * 60_000) });
    }
  }
  if (newLogs.length) await prisma.cleaningLog.createMany({ data: newLogs });

  // Traçabilité : une réception et deux préparations par jour récent ; ce qui a dépassé sa date est passé (utilisé)
  const supplier = await prisma.supplier.findFirst({ where: { establishmentId: ctx.estId }, orderBy: { createdAt: "asc" }, select: { name: true } });
  for (let d = addDays(today, -2); d <= today; d = addDays(d, 1)) {
    const when = at(d, ctx.tz, 7, 45);
    if (when > now || (await prisma.traceRecord.count({ where: { establishmentId: ctx.estId, madeAt: { gte: startOfLocalDay(d, ctx.tz), lt: startOfLocalDay(addDays(d, 1), ctx.tz) } } }))) continue;
    const rand = rng(`trace-${d}`);
    const rec = RECEPTIONS[Math.floor(rand() * RECEPTIONS.length)];
    const p1 = PREPARATIONS[Math.floor(rand() * PREPARATIONS.length)];
    const p2 = PREPARATIONS.find((p) => p !== p1)!;
    const lot = `L${d.slice(2, 4)}${d.slice(5, 7)}${d.slice(8, 10)}`;
    await prisma.traceRecord.createMany({ data: [
      { establishmentId: ctx.estId, kind: "RECEPTION", name: rec.name, supplierName: supplier?.name ?? null, lotNumber: lot, quantity: rec.qty, temperature: rec.t, madeAt: when, useBy: at(addDays(d, 3), ctx.tz, 23, 59), userId: ctx.managerId },
      { establishmentId: ctx.estId, kind: "PREPARATION", name: p1, quantity: "2 L", madeAt: at(d, ctx.tz, 9, 15), useBy: at(addDays(d, 2), ctx.tz, 23, 59), userId: ctx.managerId },
      { establishmentId: ctx.estId, kind: "PREPARATION", name: p2, madeAt: at(d, ctx.tz, 10, 0), useBy: at(addDays(d, 1), ctx.tz, 23, 59), userId: ctx.managerId },
    ] });
  }

  await prisma.traceRecord.updateMany({ where: { establishmentId: ctx.estId, closedAt: null, useBy: { lt: startOfLocalDay(today, ctx.tz) } }, data: { closedAt: startOfLocalDay(today, ctx.tz), closedReason: "USED" } });

  // Historique limité (les relevés des visiteurs comptent aussi)
  const cutoff = startOfLocalDay(addDays(today, -90), ctx.tz);
  await prisma.temperatureReading.deleteMany({ where: { establishmentId: ctx.estId, takenAt: { lt: cutoff } } });
  await prisma.cleaningLog.deleteMany({ where: { establishmentId: ctx.estId, doneAt: { lt: cutoff } } });
  await prisma.traceRecord.deleteMany({ where: { establishmentId: ctx.estId, madeAt: { lt: cutoff } } });
  return { readings: newReadings.length, cleaning: newLogs.length };
}
