import { prisma } from "@/server/db";
import { addDays, endOfLocalDay, startOfLocalDay } from "@/lib/dates";

export type DailySummary = {
  day: string;
  revenue: number; // CA TTC net (commandes payées)
  revenueHt: number;
  tax: number;
  tickets: number;
  covers: number;
  avgTicket: number;
  avgPerCover: number;
  discounts: number;
  cancellations: number;
  tips: number;
  foodCost: number;
  foodCostPct: number | null;
  openOrders: number;
  byHour: { hour: number; revenue: number; tickets: number }[];
  byCategory: { name: string; revenue: number; quantity: number }[];
  byProduct: { name: string; revenue: number; quantity: number }[];
  byServer: { name: string; revenue: number; tickets: number }[];
  byMethod: { method: string; amount: number; count: number }[];
  previous: { day: string; revenue: number; tickets: number; covers: number } | null;
};

export async function getDailySummary(establishmentId: string, day: string, timezone: string, withPrevious = true): Promise<DailySummary> {
  const from = startOfLocalDay(day, timezone);
  const to = endOfLocalDay(day, timezone);
  const orders = await prisma.order.findMany({
    where: { establishmentId, closedAt: { gte: from, lt: to }, status: { in: ["PAID", "CANCELLED"] } },
    include: { items: { include: { product: { select: { category: { select: { name: true } } } } } }, payments: true, server: { select: { firstName: true, lastName: true, displayName: true } } },
  });
  const paid = orders.filter((o) => o.status === "PAID");
  const revenue = paid.reduce((a, o) => a + o.total, 0);
  const tax = paid.reduce((a, o) => a + o.taxTotal, 0);
  const covers = paid.reduce((a, o) => a + o.covers, 0);
  const byHour = new Map<number, { revenue: number; tickets: number }>();
  const byCategory = new Map<string, { revenue: number; quantity: number }>();
  const byProduct = new Map<string, { revenue: number; quantity: number }>();
  const byServer = new Map<string, { revenue: number; tickets: number }>();
  const byMethod = new Map<string, { amount: number; count: number }>();
  let foodCost = 0;
  for (const o of paid) {
    const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(o.closedAt!));
    const h = byHour.get(hour) ?? { revenue: 0, tickets: 0 };
    h.revenue += o.total; h.tickets++; byHour.set(hour, h);
    const serverName = o.server ? o.server.displayName || `${o.server.firstName} ${o.server.lastName}` : "—";
    const s = byServer.get(serverName) ?? { revenue: 0, tickets: 0 };
    s.revenue += o.total; s.tickets++; byServer.set(serverName, s);
    for (const it of o.items) {
      if (it.status === "VOIDED") continue;
      foodCost += it.costPrice * it.quantity;
      if (it.parentItemId) continue; // composants de formule comptés via le parent
      const cat = it.product?.category?.name ?? (it.menuId ? "Formules" : "Sans catégorie");
      const c = byCategory.get(cat) ?? { revenue: 0, quantity: 0 };
      c.revenue += it.lineTotal; c.quantity += it.quantity; byCategory.set(cat, c);
      const p = byProduct.get(it.name) ?? { revenue: 0, quantity: 0 };
      p.revenue += it.lineTotal; p.quantity += it.quantity; byProduct.set(it.name, p);
    }
    for (const pay of o.payments) {
      const m = byMethod.get(pay.method) ?? { amount: 0, count: 0 };
      m.amount += pay.amount - pay.refundedAmount; m.count++; byMethod.set(pay.method, m);
    }
  }
  const openOrders = await prisma.order.count({ where: { establishmentId, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] } } });
  const previous = withPrevious ? await getDailySummary(establishmentId, addDays(day, -7), timezone, false) : null;
  return {
    day, revenue, revenueHt: revenue - tax, tax, tickets: paid.length, covers,
    avgTicket: paid.length ? Math.round(revenue / paid.length) : 0,
    avgPerCover: covers ? Math.round(revenue / covers) : 0,
    discounts: paid.reduce((a, o) => a + o.discountTotal, 0),
    cancellations: orders.filter((o) => o.status === "CANCELLED").length,
    tips: paid.reduce((a, o) => a + o.tipTotal, 0),
    foodCost, foodCostPct: revenue > 0 ? Math.round((foodCost / revenue) * 1000) / 10 : null,
    openOrders,
    byHour: [...byHour.entries()].map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour),
    byCategory: [...byCategory.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue),
    byProduct: [...byProduct.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 15),
    byServer: [...byServer.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue),
    byMethod: [...byMethod.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount),
    previous: previous ? { day: previous.day, revenue: previous.revenue, tickets: previous.tickets, covers: previous.covers } : null,
  };
}

/** CA par jour sur une période (pour les graphiques et les comparaisons). */
export async function getRevenueByDay(establishmentId: string, fromDay: string, toDay: string, timezone: string) {
  const orders = await prisma.order.findMany({
    where: { establishmentId, status: "PAID", closedAt: { gte: startOfLocalDay(fromDay, timezone), lt: endOfLocalDay(toDay, timezone) } },
    select: { total: true, covers: true, closedAt: true },
  });
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const map = new Map<string, { revenue: number; tickets: number; covers: number }>();
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) map.set(d, { revenue: 0, tickets: 0, covers: 0 });
  for (const o of orders) {
    const d = fmt.format(o.closedAt!);
    const e = map.get(d);
    if (e) { e.revenue += o.total; e.tickets++; e.covers += o.covers; }
  }
  return [...map.entries()].map(([day, v]) => ({ day, ...v }));
}

/** Vue multi-établissements (propriétaire). */
export async function getOrganizationOverview(organizationId: string, day: string) {
  const establishments = await prisma.establishment.findMany({ where: { organizationId, isActive: true }, orderBy: { name: "asc" } });
  const rows = [];
  for (const e of establishments) {
    const s = await getDailySummary(e.id, day, e.timezone, true);
    rows.push({ establishment: { id: e.id, name: e.name, city: e.city, currency: e.currency }, revenue: s.revenue, tickets: s.tickets, covers: s.covers, openOrders: s.openOrders, previousRevenue: s.previous?.revenue ?? 0 });
  }
  return rows;
}
