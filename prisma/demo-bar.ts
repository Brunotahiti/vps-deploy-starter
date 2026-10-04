/**
 * Restaurant exemple, option Bar : cave du bar (bouteilles au cl, bières à la pièce), fiches des cocktails de la carte,
 * happy hour de 17 h à 19 h sur les cocktails, bières et vins, et deux ardoises ouvertes au comptoir (renouvelées à chaque rafraîchissement).
 * Cave, fiches et happy hour sont créés une seule fois ; une casse d'exemple alimente le rapport du bar.
 */
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { computeLine, computeOrderTotals } from "../src/lib/order-calc";
import { startOfLocalDay } from "../src/lib/dates";
import type { DemoCtx } from "./demo-activity";

type B = { name: string; kind: string; unit: "cl" | "pce"; ml?: number; bottles: number; min: number; cost: number };
const CELLAR: B[] = [
  { name: "Rhum blanc", kind: "spirit", unit: "cl", ml: 700, bottles: 4.5, min: 2, cost: 2600 },
  { name: "Rhum ambré", kind: "spirit", unit: "cl", ml: 700, bottles: 3.25, min: 2, cost: 3400 },
  { name: "Vodka", kind: "spirit", unit: "cl", ml: 700, bottles: 2, min: 1, cost: 3100 },
  { name: "Gin", kind: "spirit", unit: "cl", ml: 700, bottles: 0.5, min: 1, cost: 3600 },
  { name: "Liqueur de coco", kind: "spirit", unit: "cl", ml: 700, bottles: 1.75, min: 1, cost: 2900 },
  { name: "Vin rouge", kind: "wine", unit: "cl", ml: 750, bottles: 9, min: 4, cost: 1900 },
  { name: "Vin blanc", kind: "wine", unit: "cl", ml: 750, bottles: 7.5, min: 4, cost: 1900 },
  { name: "Vin rosé", kind: "wine", unit: "cl", ml: 750, bottles: 6, min: 4, cost: 1800 },
  { name: "Hinano 33 cl", kind: "beer", unit: "pce", bottles: 96, min: 48, cost: 210 },
  { name: "Tabu blonde 33 cl", kind: "beer", unit: "pce", bottles: 30, min: 24, cost: 230 },
  { name: "Fût Hinano pression 30 L", kind: "beer", unit: "cl", ml: 30000, bottles: 1.4, min: 1, cost: 16800 },
  { name: "Jus d'ananas", kind: "soft", unit: "cl", ml: 1000, bottles: 6, min: 3, cost: 450 },
  { name: "Crème de coco", kind: "soft", unit: "cl", ml: 1000, bottles: 2, min: 1, cost: 650 },
  { name: "Eau gazeuse 1 L", kind: "soft", unit: "cl", ml: 1000, bottles: 5, min: 3, cost: 220 },
  { name: "Sirop de sucre de canne", kind: "syrup", unit: "cl", ml: 700, bottles: 1.5, min: 1, cost: 900 },
  { name: "Citron vert", kind: "other", unit: "pce", bottles: 40, min: 20, cost: 40 },
  { name: "Coca-Cola 33 cl", kind: "soft", unit: "pce", bottles: 120, min: 48, cost: 150 },
  { name: "Eau minérale 50 cl", kind: "soft", unit: "pce", bottles: 84, min: 36, cost: 95 },
];

type Card = { product: string; glass?: string; garnish?: string; method?: string; doses: [string, number][] };
const CARDS: Card[] = [
  { product: "Cocktail Mai Tai", glass: "Verre tiki", garnish: "Quartier d'ananas et feuille de menthe", method: "Au shaker avec des glaçons.\nFiltrer sur glace pilée, rhum ambré en dernier, en surface.", doses: [["Rhum blanc", 2], ["Rhum ambré", 4], ["Sirop de sucre de canne", 1], ["Jus d'ananas", 6], ["Citron vert", 0.5]] },
  { product: "Cocktail Piña Colada", glass: "Verre hurricane", garnish: "Tranche d'ananas", method: "Au blender avec une poignée de glace pilée, servir aussitôt.", doses: [["Rhum blanc", 4], ["Liqueur de coco", 2], ["Crème de coco", 3], ["Jus d'ananas", 10]] },
  { product: "Mojito", glass: "Tumbler", garnish: "Brin de menthe fraîche", method: "Piler doucement la menthe et le citron avec le sirop.\nRemplir de glace pilée, ajouter le rhum, compléter à l'eau gazeuse et mélanger.", doses: [["Rhum blanc", 5], ["Sirop de sucre de canne", 2], ["Eau gazeuse 1 L", 10], ["Citron vert", 0.5]] },
  { product: "Verre de vin rouge", glass: "Verre à vin", doses: [["Vin rouge", 12]] },
  { product: "Verre de vin blanc", glass: "Verre à vin", doses: [["Vin blanc", 12]] },
  { product: "Verre de rosé", glass: "Verre à vin", doses: [["Vin rosé", 12]] },
  { product: "Hinano 33 cl", doses: [["Hinano 33 cl", 1]] },
  { product: "Tabu blonde 33 cl", doses: [["Tabu blonde 33 cl", 1]] },
  { product: "Hinano pression 50 cl", glass: "Chope 50 cl", doses: [["Fût Hinano pression 30 L", 50]] },
];

const TABS: { name: string; minutesAgo: number; items: string[] }[] = [
  { name: "Teiki", minutesAgo: 75, items: ["Hinano pression 50 cl", "Hinano pression 50 cl", "Mojito"] },
  { name: "Groupe terrasse", minutesAgo: 40, items: ["Cocktail Mai Tai", "Cocktail Piña Colada", "Verre de vin blanc", "Jus d'ananas"] },
];

export async function barDemo(prisma: PrismaClient, ctx: DemoCtx, today: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { options: true } });
  if (!org.options.includes("bar")) await prisma.organization.update({ where: { id: ctx.orgId }, data: { options: [...org.options, "bar"] } });
  let created = 0;

  // Cave, fiches et happy hour : une seule fois
  if (!(await prisma.ingredient.count({ where: { establishmentId: ctx.estId, barKind: { not: null } } }))) {
    const ids = new Map<string, string>();
    for (const b of CELLAR) {
      const per = b.unit === "cl" ? b.ml! / 10 : 1;
      // Déjà suivie par le stock (bière, sodas) : rattachée à la cave, sans doublon (sinon chaque vente décompterait deux fois)
      // Un ingrédient aussi utilisé en cuisine (citron vert…) reste à la cuisine : le bar a le sien
      const existing = await prisma.ingredient.findFirst({ where: { establishmentId: ctx.estId, name: b.name }, select: { id: true, recipeLines: { where: { product: { NOT: { kitchenStation: { name: { contains: "bar", mode: "insensitive" } } } } }, select: { productId: true }, take: 1 } } });
      if (existing && !existing.recipeLines.length) { await prisma.ingredient.update({ where: { id: existing.id }, data: { barKind: b.kind, bottleMl: b.unit === "cl" ? b.ml! : null } }); ids.set(b.name, existing.id); continue; }
      const row = await prisma.ingredient.create({ data: { establishmentId: ctx.estId, name: existing ? `${b.name} (bar)` : b.name, unit: b.unit, barKind: b.kind, bottleMl: b.unit === "cl" ? b.ml! : null, stockQty: b.bottles * per, stockMin: b.min * per, avgCost: Math.round(b.cost / per), lastCost: Math.round(b.cost / per) } });
      ids.set(b.name, row.id);
    }
    const products = await prisma.product.findMany({ where: { establishmentId: ctx.estId, name: { in: CARDS.map((c) => c.product) } }, select: { id: true, name: true } });
    for (const c of CARDS) {
      const p = products.find((x) => x.name === c.product);
      if (!p) continue;
      const spec = c.glass || c.garnish || c.method ? { glass: c.glass ?? null, garnish: c.garnish ?? null, method: c.method ?? null } : undefined;
      if (spec) await prisma.product.update({ where: { id: p.id }, data: { barSpec: spec } });
      await prisma.recipeLine.createMany({ data: c.doses.filter(([n]) => ids.has(n)).map(([n, q]) => ({ productId: p.id, ingredientId: ids.get(n)!, quantity: q })), skipDuplicates: true });
    }
    // Happy hour sur les cocktails, bières et vins (pas sur l'eau, les sodas ni le café)
    const hhProducts = await prisma.product.findMany({ where: { establishmentId: ctx.estId, OR: [{ name: { startsWith: "Cocktail" } }, { name: { in: ["Mojito", "Hinano 33 cl", "Hinano pression 50 cl", "Tabu blonde 33 cl", "Verre de vin rouge", "Verre de vin blanc", "Verre de rosé"] } }] }, select: { id: true } });
    const est = await prisma.establishment.findUniqueOrThrow({ where: { id: ctx.estId }, select: { settings: true } });
    const settings = (est.settings ?? {}) as Record<string, unknown>;
    if (hhProducts.length) await prisma.establishment.update({ where: { id: ctx.estId }, data: { settings: { ...settings, bar: { happyHours: [{ id: "demo-hh", name: "Happy hour", days: [0, 1, 2, 3, 4, 5, 6], start: "17:00", end: "19:00", discountBps: 3000, categoryIds: [], productIds: hhProducts.map((p) => p.id), enabled: true }] } } as Prisma.InputJsonValue } });
    // Une casse d'exemple (hier soir) pour le rapport du bar
    const rose = ids.get("Vin rosé");
    if (rose) await prisma.inventoryMovement.create({ data: { establishmentId: ctx.estId, ingredientId: rose, userId: ctx.managerId, kind: "BREAKAGE", quantity: -75, unitCost: Math.round(1800 / 75), reason: "Bouteille tombée au service", createdAt: new Date(startOfLocalDay(today, ctx.tz).getTime() - 3 * 3600_000) } });
    created += CELLAR.length;
  }

  // Ardoises du jour au comptoir : deux ardoises ouvertes, renouvelées à chaque rafraîchissement
  const dayStart = startOfLocalDay(today, ctx.tz);
  const open = await prisma.order.count({ where: { establishmentId: ctx.estId, isTab: true, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] } } });
  if (open) return created;
  const all = await prisma.product.findMany({ where: { establishmentId: ctx.estId, isActive: true, name: { in: [...new Set(TABS.flatMap((t) => t.items))] } }, include: { taxRate: { select: { rateBps: true, name: true } } } });
  const prefix = today.replace(/-/g, "");
  const taken = new Set((await prisma.order.findMany({ where: { establishmentId: ctx.estId, number: { startsWith: `${prefix}-` } }, select: { number: true } })).map((o) => o.number));
  let seq = 190;
  for (const [ti, t] of TABS.entries()) {
    while (taken.has(`${prefix}-${String(seq).padStart(4, "0")}`) && seq < 199) seq++;
    const number = `${prefix}-${String(seq).padStart(4, "0")}`;
    taken.add(number);
    const openedAt = new Date(Math.max(dayStart.getTime(), Date.now() - t.minutesAgo * 60_000));
    const order = await prisma.order.create({ data: { establishmentId: ctx.estId, number, type: "COUNTER", isTab: true, customerName: t.name, serverId: ctx.servers[ti % ctx.servers.length] ?? ctx.ownerId, status: "SENT", openedAt, createdAt: openedAt, channelMeta: { demo: true }, courses: { create: [{ name: "COMMANDE", sortOrder: 0, status: "SENT" }] } }, include: { courses: true } });
    const lines: Parameters<typeof computeOrderTotals>[0] = [];
    for (const [i, name] of t.items.entries()) {
      const p = all.find((x) => x.name === name);
      if (!p) continue;
      const rate = p.taxRate?.rateBps ?? 1600;
      const calc = computeLine({ quantity: 1, unitPrice: p.priceTtc, modifiersTotal: 0, discountAmount: 0, taxRateBps: rate });
      lines.push({ quantity: 1, unitPrice: p.priceTtc, modifiersTotal: 0, discountAmount: 0, taxRateBps: rate, taxRateName: p.taxRate?.name ?? "TVA" });
      await prisma.orderItem.create({ data: { orderId: order.id, courseId: order.courses[0].id, productId: p.id, kitchenStationId: p.kitchenStationId, name: p.name, quantity: 1, unitPrice: p.priceTtc, lineTotal: calc.lineTotal, taxRateBps: rate, taxRateName: p.taxRate?.name ?? "TVA", taxAmount: calc.taxAmount, costPrice: p.costPrice, sortOrder: i, status: "SERVED", sentAt: openedAt, servedAt: new Date(openedAt.getTime() + 5 * 60_000), createdAt: openedAt } });
    }
    const totals = computeOrderTotals(lines, 0);
    await prisma.order.update({ where: { id: order.id }, data: { subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total } });
    created++;
  }
  return created;
}
