import { prisma } from "@/server/db";
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";
import { getPeriodReport, type PeriodReport } from "./reports";
import { staffSummary } from "./staff";

/**
 * Statistiques complètes d'une période : rapport de ventes (avec comparaison), personnel,
 * cuisine (temps de préparation), réservations (no-show), durée de service, clients fidèles,
 * et « faits marquants » calculés côté serveur pour la page Statistiques.
 */
export type Stats = {
  period: PeriodReport;
  staff: { hours: number; cost: number; laborCostPct: number | null; revenuePerHour: number | null; employees: number };
  primeCostPct: number | null; // coût matière + personnel / CA HT
  kitchen: { tickets: number; avgPrepSec: number | null; over15MinPct: number | null; byStation: { name: string; tickets: number; avgPrepSec: number | null }[] };
  reservations: { total: number; completed: number; noShow: number; cancelled: number; pending: number; covers: number; noShowPct: number | null };
  service: { dineInTickets: number; avgDurationMin: number | null; avgCoversPerTable: number | null };
  customers: { known: number; returning: number; loyaltyOrders: number; onlineShare: number | null };
  highlights: { kind: "good" | "warn" | "info"; text: string }[];
};

const num = (v: number) => new Intl.NumberFormat("fr-FR").format(v);
const money = (v: number) => `${num(v)} F`;

export async function getStats(establishmentId: string, fromDay: string, toDay: string, timezone: string): Promise<Stats> {
  const from = startOfLocalDay(fromDay, timezone), to = endOfLocalDay(toDay, timezone);
  const [period, staff, tickets, stations, reservations, dineIn, customerOrders] = await Promise.all([
    getPeriodReport(establishmentId, fromDay, toDay, timezone),
    staffSummary(establishmentId, fromDay, toDay, timezone),
    prisma.kitchenTicket.findMany({ where: { order: { establishmentId }, createdAt: { gte: from, lt: to }, readyAt: { not: null } }, select: { stationId: true, createdAt: true, readyAt: true } }),
    prisma.kitchenStation.findMany({ where: { establishmentId }, select: { id: true, name: true } }),
    prisma.reservation.groupBy({ by: ["status"], where: { establishmentId, startsAt: { gte: from, lt: to } }, _count: { _all: true }, _sum: { partySize: true } }),
    prisma.order.findMany({ where: { establishmentId, status: "PAID", type: "DINE_IN", closedAt: { gte: from, lt: to } }, select: { createdAt: true, closedAt: true, covers: true } }),
    prisma.order.findMany({ where: { establishmentId, status: "PAID", closedAt: { gte: from, lt: to }, customerId: { not: null } }, select: { customerId: true } }),
  ]);
  // Cuisine
  const prep = tickets.map((t) => (t.readyAt!.getTime() - t.createdAt.getTime()) / 1000);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const byStation = stations.map((s) => { const mine = tickets.filter((t) => t.stationId === s.id).map((t) => (t.readyAt!.getTime() - t.createdAt.getTime()) / 1000); return { name: s.name, tickets: mine.length, avgPrepSec: avg(mine) }; }).filter((s) => s.tickets > 0);
  const kitchen = { tickets: tickets.length, avgPrepSec: avg(prep), over15MinPct: prep.length ? Math.round((prep.filter((p) => p > 900).length / prep.length) * 1000) / 10 : null, byStation };
  // Réservations
  const count = (st: string) => reservations.find((r) => r.status === st)?._count._all ?? 0;
  const total = reservations.reduce((a, r) => a + r._count._all, 0);
  const noShow = count("NO_SHOW"), completed = count("COMPLETED") + count("SEATED") + count("ARRIVED"), cancelled = count("CANCELLED"), pending = count("PENDING") + count("CONFIRMED");
  const honoured = completed + noShow;
  const resa = { total, completed, noShow, cancelled, pending, covers: reservations.reduce((a, r) => a + (r._sum.partySize ?? 0), 0), noShowPct: honoured ? Math.round((noShow / honoured) * 1000) / 10 : null };
  // Service à table
  const durations = dineIn.map((o) => (o.closedAt!.getTime() - o.createdAt.getTime()) / 60_000).filter((m) => m > 0 && m < 12 * 60);
  const service = { dineInTickets: dineIn.length, avgDurationMin: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null, avgCoversPerTable: dineIn.length ? Math.round((dineIn.reduce((a, o) => a + o.covers, 0) / dineIn.length) * 10) / 10 : null };
  // Clients
  const perCustomer = new Map<string, number>();
  for (const o of customerOrders) perCustomer.set(o.customerId!, (perCustomer.get(o.customerId!) ?? 0) + 1);
  const digital = period.byType.filter((t) => ["ONLINE", "DELIVERY", "TAKEAWAY", "KIOSK"].includes(t.type)).reduce((a, t) => a + t.revenue, 0);
  const customers = { known: perCustomer.size, returning: [...perCustomer.values()].filter((n) => n > 1).length, loyaltyOrders: customerOrders.length, onlineShare: period.revenue > 0 ? Math.round((digital / period.revenue) * 1000) / 10 : null };
  const primeCostPct = period.revenueHt > 0 ? Math.round(((period.foodCost + staff.totalCost) / period.revenueHt) * 1000) / 10 : null;

  // Faits marquants
  const h: Stats["highlights"] = [];
  const pct = (a: number, b: number | null | undefined) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
  const dRev = pct(period.revenue, period.previous?.revenue);
  if (dRev !== null) h.push({ kind: dRev >= 0 ? "good" : "warn", text: `Chiffre d'affaires ${dRev >= 0 ? "en hausse" : "en baisse"} de ${Math.abs(dRev)} % par rapport à la période précédente (${money(period.previous!.revenue)}).` });
  const bestDay = [...period.byDay].sort((a, b) => b.revenue - a.revenue)[0];
  if (bestDay && bestDay.revenue > 0) h.push({ kind: "info", text: `Meilleure journée : ${new Date(bestDay.day + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} avec ${money(bestDay.revenue)} et ${bestDay.tickets} tickets.` });
  const bestHour = [...period.byHour].sort((a, b) => b.revenue - a.revenue)[0];
  if (bestHour) h.push({ kind: "info", text: `Heure de pointe : ${bestHour.hour} h – ${bestHour.hour + 1} h (${money(bestHour.revenue)} sur la période).` });
  const star = period.byProduct[0];
  if (star) h.push({ kind: "info", text: `Produit star : ${star.name}, ${star.quantity} vendus pour ${money(star.revenue)}.` });
  if (period.foodCostPct !== null) h.push({ kind: period.foodCostPct > 35 ? "warn" : "good", text: `Coût matière à ${period.foodCostPct} % du CA HT${period.foodCostPct > 35 ? " : au-dessus des 35 % recommandés, vérifiez les recettes et les pertes." : ", dans la bonne zone (objectif ≤ 35 %)."}` });
  if (staff.laborCostPct !== null) h.push({ kind: staff.laborCostPct > 35 ? "warn" : "good", text: `Coût du personnel à ${staff.laborCostPct} % du CA HT (${staff.totalHours} h pointées, ${money(staff.totalCost)}).` });
  if (resa.noShowPct !== null && resa.noShowPct >= 10) h.push({ kind: "warn", text: `${resa.noShowPct} % de réservations non honorées (${resa.noShow} no-show) : pensez à confirmer par téléphone la veille.` });
  if (kitchen.avgPrepSec !== null) h.push({ kind: kitchen.avgPrepSec > 900 ? "warn" : "good", text: `Temps de préparation moyen en cuisine : ${Math.round(kitchen.avgPrepSec / 60)} min${kitchen.over15MinPct ? ` (${kitchen.over15MinPct} % des tickets au-delà de 15 min)` : ""}.` });
  if (customers.onlineShare !== null && customers.onlineShare > 0) h.push({ kind: "info", text: `${customers.onlineShare} % du chiffre d'affaires vient de la vente à emporter, en ligne, en livraison ou à la borne.` });
  if (period.cancellations > 0 && period.tickets > 0 && period.cancellations / (period.tickets + period.cancellations) > 0.05) h.push({ kind: "warn", text: `${period.cancellations} commandes annulées sur la période : consultez le journal d'audit pour en connaître les motifs.` });

  return { period, staff: { hours: staff.totalHours, cost: staff.totalCost, laborCostPct: staff.laborCostPct, revenuePerHour: staff.revenuePerHour, employees: staff.rows.length }, primeCostPct, kitchen, reservations: resa, service, customers, highlights: h };
}
