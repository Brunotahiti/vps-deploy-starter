import { prisma } from "@/server/db";
import { addDays, endOfLocalDay, localDay, startOfLocalDay } from "@/lib/dates";

/**
 * Prévisions de fréquentation façon Bison Futé (option Assistant IA), calculées par le programme lui-même :
 * - habitude du même jour de la semaine sur les 8 dernières semaines (couverts sur place + commandes à emporter),
 *   corrigée de la tendance des 4 dernières semaines ;
 * - réservations déjà prises pour le jour (le sur-place sans réservation s'y ajoute) ;
 * - couleur selon la charge par rapport aux grosses journées habituelles du restaurant.
 */

export type ForecastLevel = "green" | "orange" | "red" | "black";
export const LEVELS: Record<ForecastLevel, { label: string; hint: string }> = {
  green: { label: "Calme", hint: "Journée tranquille : idéale pour une offre ou la mise en place de fond" },
  orange: { label: "Soutenu", hint: "Activité habituelle d'une bonne journée" },
  red: { label: "Chargé", hint: "Prévoyez du renfort et une mise en place généreuse" },
  black: { label: "Très chargé", hint: "Journée exceptionnelle : équipe au complet, stock vérifié la veille" },
};

const HISTORY_WEEKS = 8;
const LUNCH_END_HOUR = 16;

type DayStat = { day: string; dineCovers: number; takeaway: number; lunch: number; dinner: number; reservedCovers: number };

const hourIn = (d: Date, tz: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
};
const weekday = (day: string) => new Date(`${day}T12:00:00Z`).getUTCDay();

/** Activité réelle de chaque jour passé (jours sans aucune vente : fermés, ignorés) */
export async function dailyHistory(establishmentId: string, timezone: string, today: string, weeks = HISTORY_WEEKS): Promise<DayStat[]> {
  const from = startOfLocalDay(addDays(today, -weeks * 7), timezone);
  const to = startOfLocalDay(today, timezone);
  const [orders, resas] = await Promise.all([
    prisma.order.findMany({ where: { establishmentId, status: "PAID", openedAt: { gte: from, lt: to } }, select: { openedAt: true, type: true, covers: true } }),
    prisma.reservation.findMany({ where: { establishmentId, startsAt: { gte: from, lt: to }, status: { in: ["SEATED", "COMPLETED"] } }, select: { startsAt: true, partySize: true } }),
  ]);
  const days = new Map<string, DayStat>();
  const get = (day: string) => { let d = days.get(day); if (!d) { d = { day, dineCovers: 0, takeaway: 0, lunch: 0, dinner: 0, reservedCovers: 0 }; days.set(day, d); } return d; };
  for (const o of orders) {
    const d = get(localDay(o.openedAt, timezone));
    const clients = o.type === "DINE_IN" ? Math.max(1, o.covers) : 1;
    if (o.type === "DINE_IN") d.dineCovers += clients; else d.takeaway += 1;
    if (hourIn(o.openedAt, timezone) < LUNCH_END_HOUR) d.lunch += clients; else d.dinner += clients;
  }
  for (const r of resas) { const day = localDay(r.startsAt, timezone); if (days.has(day)) get(day).reservedCovers += r.partySize; }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export type ForecastDay = {
  day: string;
  closed: boolean;
  level: ForecastLevel;
  expected: { clients: number; covers: number; takeaway: number; lunch: number; dinner: number };
  booked: { reservations: number; covers: number };
  usual: number;
  confidence: "low" | "medium" | "high";
  advice: string;
};

export async function forecast(establishmentId: string, timezone: string, days = 14, from?: string): Promise<{ days: ForecastDay[]; reference: number; historyDays: number; trend: number }> {
  const today = localDay(new Date(), timezone);
  const start = from ?? today;
  const history = await dailyHistory(establishmentId, timezone, today);
  const clientsOf = (d: DayStat) => d.dineCovers + d.takeaway;
  // Tendance : 4 dernières semaines contre les 4 précédentes (bornée à ±20 %)
  const cut = addDays(today, -28);
  const recent = avg(history.filter((d) => d.day >= cut).map(clientsOf));
  const older = avg(history.filter((d) => d.day < cut).map(clientsOf));
  const trend = recent && older ? Math.min(1.2, Math.max(0.8, recent / older)) : 1;
  // Une « grosse journée » du restaurant : 90e centile des journées passées
  const reference = Math.max(1, quantile(history.map(clientsOf), 0.9));

  const upcoming = await prisma.reservation.findMany({
    where: { establishmentId, status: { in: ["PENDING", "CONFIRMED", "ARRIVED", "SEATED", "COMPLETED"] }, startsAt: { gte: startOfLocalDay(start, timezone), lt: endOfLocalDay(addDays(start, days - 1), timezone) } },
    select: { startsAt: true, partySize: true },
  });

  const out: ForecastDay[] = [];
  for (let i = 0; i < days; i++) {
    const day = addDays(start, i);
    const same = history.filter((d) => weekday(d.day) === weekday(day));
    const booked = upcoming.filter((r) => localDay(r.startsAt, timezone) === day);
    const bookedCovers = booked.reduce((a, r) => a + r.partySize, 0);
    const weeksSeen = HISTORY_WEEKS;
    // Jour habituellement fermé (vendu moins d'une semaine sur quatre) et sans réservation
    const closed = same.length < Math.ceil(weeksSeen / 4) && history.length >= 14 && bookedCovers === 0;
    const usualCovers = avg(same.map((d) => d.dineCovers)) * trend;
    const usualTakeaway = avg(same.map((d) => d.takeaway)) * trend;
    const walkIn = avg(same.map((d) => Math.max(0, d.dineCovers - d.reservedCovers))) * trend;
    const covers = Math.round(Math.max(usualCovers, bookedCovers + walkIn));
    const takeaway = Math.round(usualTakeaway);
    const lunchShare = avg(same.map((d) => (d.lunch + d.dinner ? d.lunch / (d.lunch + d.dinner) : 0.5))) || 0.5;
    const clients = closed ? 0 : covers + takeaway;
    const ratio = clients / reference;
    const level: ForecastLevel = ratio >= 1 ? "black" : ratio >= 0.8 ? "red" : ratio >= 0.55 ? "orange" : "green";
    const usual = Math.round(avg(same.map(clientsOf)) * trend);
    const confidence = same.length >= 6 ? "high" : same.length >= 3 ? "medium" : "low";
    const vsUsual = usual ? Math.round(((clients - usual) / usual) * 100) : 0;
    const advice = closed ? "Habituellement fermé" : bookedCovers && vsUsual >= 15
      ? `Réservations en avance : ${vsUsual} % de plus qu'un ${new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))} habituel`
      : LEVELS[level].hint;
    out.push({
      day, closed, level: closed ? "green" : level,
      expected: { clients, covers: closed ? 0 : covers, takeaway: closed ? 0 : takeaway, lunch: closed ? 0 : Math.round(clients * lunchShare), dinner: closed ? 0 : clients - Math.round(clients * lunchShare) },
      booked: { reservations: booked.length, covers: bookedCovers }, usual, confidence, advice,
    });
  }
  return { days: out, reference: Math.round(reference), historyDays: history.length, trend: Math.round(trend * 100) / 100 };
}
