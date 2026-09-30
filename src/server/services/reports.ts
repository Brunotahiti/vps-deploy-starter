import { prisma } from "@/server/db";
import { addDays, endOfLocalDay, startOfLocalDay } from "@/lib/dates";


/** Ligne produit avec coût matière et marge (HT). */
export type ProductLine = { name: string; revenue: number; revenueHt: number; cost: number; margin: number; marginPct: number | null; quantity: number };
export type Profitability = { best: ProductLine[]; worst: ProductLine[]; unknownCost: number };
type SaleItem = { id: string; name: string; status: string; quantity: number; lineTotal: number; costPrice: number; taxRateBps: number; parentItemId: string | null };
type ProdAgg = { revenue: number; revenueHt: number; cost: number; quantity: number };

/** Agrège les articles d'une commande par produit : CA TTC/HT, coût matière (composants de formule imputés au parent), quantité. */
function addItemsToProducts(map: Map<string, ProdAgg>, items: SaleItem[]) {
  const parentName = new Map(items.filter((i) => !i.parentItemId).map((i) => [i.id, i.name]));
  for (const it of items) {
    if (it.status === "VOIDED") continue;
    const key = it.parentItemId ? parentName.get(it.parentItemId) : it.name;
    if (!key) continue;
    const p = map.get(key) ?? { revenue: 0, revenueHt: 0, cost: 0, quantity: 0 };
    p.cost += it.costPrice * it.quantity;
    if (!it.parentItemId) { p.revenue += it.lineTotal; p.revenueHt += it.lineTotal / (1 + it.taxRateBps / 10000); p.quantity += it.quantity; }
    map.set(key, p);
  }
}
function productLines(map: Map<string, ProdAgg>): ProductLine[] {
  return [...map.entries()].map(([name, v]) => { const revenueHt = Math.round(v.revenueHt); const cost = Math.round(v.cost); const margin = revenueHt - cost; return { name, revenue: v.revenue, revenueHt, cost, margin, marginPct: revenueHt > 0 ? Math.round((margin / revenueHt) * 1000) / 10 : null, quantity: v.quantity }; });
}
/** Plats les plus et les moins rentables (marge HT en %), hors produits sans coût renseigné. */
function profitability(lines: ProductLine[], n = 5): Profitability {
  const known = lines.filter((l) => l.cost > 0 && l.revenueHt > 0 && l.marginPct !== null);
  const byPct = [...known].sort((a, b) => (b.marginPct ?? 0) - (a.marginPct ?? 0));
  return { best: byPct.slice(0, n), worst: byPct.slice(-n).reverse().filter((w) => !byPct.slice(0, n).includes(w)), unknownCost: lines.length - known.length };
}
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
  byProduct: ProductLine[];
  profitability: Profitability;
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
  const byProduct = new Map<string, ProdAgg>();
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
    }
    addItemsToProducts(byProduct, o.items);
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
    byProduct: productLines(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 15),
    profitability: profitability(productLines(byProduct)),
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

// ---------------------------------------------------------------------------
// Phase 5 — Rapport périodique et comparaison
// ---------------------------------------------------------------------------
export type PeriodReport = {
  from: string; to: string; days: number;
  revenue: number; revenueHt: number; tax: number; tickets: number; covers: number; avgTicket: number; avgPerCover: number;
  discounts: number; cancellations: number; tips: number; refunds: number;
  foodCost: number; foodCostPct: number | null;
  byDay: { day: string; revenue: number; tickets: number; covers: number }[];
  byWeekday: { weekday: number; label: string; revenue: number; tickets: number }[];
  byHour: { hour: number; revenue: number; tickets: number }[];
  byCategory: { name: string; revenue: number; quantity: number; share: number }[];
  byProduct: ProductLine[];
  profitability: Profitability;
  byServer: { name: string; revenue: number; tickets: number; avgTicket: number }[];
  byMethod: { method: string; amount: number; count: number }[];
  byType: { type: string; revenue: number; tickets: number }[];
  previous: { from: string; to: string; revenue: number; revenueHt: number; tickets: number; covers: number; avgTicket: number; foodCostPct: number | null } | null;
};

const WEEKDAYS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

export async function getPeriodReport(establishmentId: string, fromDay: string, toDay: string, timezone: string, withPrevious = true): Promise<PeriodReport> {
  const from = startOfLocalDay(fromDay, timezone), to = endOfLocalDay(toDay, timezone);
  const orders = await prisma.order.findMany({
    where: { establishmentId, closedAt: { gte: from, lt: to }, status: { in: ["PAID", "CANCELLED"] } },
    include: { items: { include: { product: { select: { category: { select: { name: true } } } } } }, payments: { include: { refunds: true } }, server: { select: { firstName: true, lastName: true, displayName: true } } },
  });
  const paid = orders.filter((o) => o.status === "PAID");
  const revenue = paid.reduce((a, o) => a + o.total, 0);
  const tax = paid.reduce((a, o) => a + o.taxTotal, 0);
  const covers = paid.reduce((a, o) => a + o.covers, 0);
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" });
  const byDay = new Map<string, { revenue: number; tickets: number; covers: number }>();
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) byDay.set(d, { revenue: 0, tickets: 0, covers: 0 });
  const byWeekday = new Map<number, { revenue: number; tickets: number }>();
  const byHour = new Map<number, { revenue: number; tickets: number }>();
  const byCategory = new Map<string, { revenue: number; quantity: number }>();
  const byProduct = new Map<string, ProdAgg>();
  const byServer = new Map<string, { revenue: number; tickets: number }>();
  const byMethod = new Map<string, { amount: number; count: number }>();
  const byType = new Map<string, { revenue: number; tickets: number }>();
  let foodCost = 0, refunds = 0;
  for (const o of paid) {
    const day = dayFmt.format(o.closedAt!);
    const d = byDay.get(day); if (d) { d.revenue += o.total; d.tickets++; d.covers += o.covers; }
    const wd = new Date(o.closedAt!.toLocaleString("en-US", { timeZone: timezone })).getDay();
    const w = byWeekday.get(wd) ?? { revenue: 0, tickets: 0 }; w.revenue += o.total; w.tickets++; byWeekday.set(wd, w);
    const hour = Number(hourFmt.format(o.closedAt!));
    const h = byHour.get(hour) ?? { revenue: 0, tickets: 0 }; h.revenue += o.total; h.tickets++; byHour.set(hour, h);
    const serverName = o.server ? o.server.displayName || `${o.server.firstName} ${o.server.lastName}` : "—";
    const s = byServer.get(serverName) ?? { revenue: 0, tickets: 0 }; s.revenue += o.total; s.tickets++; byServer.set(serverName, s);
    const t = byType.get(o.type) ?? { revenue: 0, tickets: 0 }; t.revenue += o.total; t.tickets++; byType.set(o.type, t);
    for (const it of o.items) {
      if (it.status === "VOIDED") continue;
      foodCost += it.costPrice * it.quantity;
      if (it.parentItemId) continue;
      const cat = it.product?.category?.name ?? (it.menuId ? "Formules" : "Sans catégorie");
      const c = byCategory.get(cat) ?? { revenue: 0, quantity: 0 }; c.revenue += it.lineTotal; c.quantity += it.quantity; byCategory.set(cat, c);
    }
    addItemsToProducts(byProduct, o.items);
    for (const pay of o.payments) {
      const m = byMethod.get(pay.method) ?? { amount: 0, count: 0 }; m.amount += pay.amount - pay.refundedAmount; m.count++; byMethod.set(pay.method, m);
      refunds += pay.refundedAmount;
    }
  }
  const days = Math.round((to.getTime() - from.getTime()) / 86400_000);
  let previous: PeriodReport["previous"] = null;
  if (withPrevious) {
    const prevTo = addDays(fromDay, -1), prevFrom = addDays(prevTo, -(days - 1));
    const p = await getPeriodReport(establishmentId, prevFrom, prevTo, timezone, false);
    previous = { from: prevFrom, to: prevTo, revenue: p.revenue, revenueHt: p.revenueHt, tickets: p.tickets, covers: p.covers, avgTicket: p.avgTicket, foodCostPct: p.foodCostPct };
  }
  return {
    from: fromDay, to: toDay, days,
    revenue, revenueHt: revenue - tax, tax, tickets: paid.length, covers,
    avgTicket: paid.length ? Math.round(revenue / paid.length) : 0, avgPerCover: covers ? Math.round(revenue / covers) : 0,
    discounts: paid.reduce((a, o) => a + o.discountTotal, 0), cancellations: orders.filter((o) => o.status === "CANCELLED").length, tips: paid.reduce((a, o) => a + o.tipTotal, 0), refunds,
    foodCost, foodCostPct: revenue > 0 ? Math.round((foodCost / revenue) * 1000) / 10 : null,
    byDay: [...byDay.entries()].map(([day, v]) => ({ day, ...v })),
    byWeekday: [1, 2, 3, 4, 5, 6, 0].map((wd) => ({ weekday: wd, label: WEEKDAYS[wd], ...(byWeekday.get(wd) ?? { revenue: 0, tickets: 0 }) })),
    byHour: [...byHour.entries()].map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour - b.hour),
    byCategory: [...byCategory.entries()].map(([name, v]) => ({ name, ...v, share: revenue > 0 ? Math.round((v.revenue / revenue) * 1000) / 10 : 0 })).sort((a, b) => b.revenue - a.revenue),
    byProduct: productLines(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 30),
    profitability: profitability(productLines(byProduct), 8),
    byServer: [...byServer.entries()].map(([name, v]) => ({ name, ...v, avgTicket: v.tickets ? Math.round(v.revenue / v.tickets) : 0 })).sort((a, b) => b.revenue - a.revenue),
    byMethod: [...byMethod.entries()].map(([method, v]) => ({ method, ...v })).sort((a, b) => b.amount - a.amount),
    byType: [...byType.entries()].map(([type, v]) => ({ type, ...v })).sort((a, b) => b.revenue - a.revenue),
    previous,
  };
}
