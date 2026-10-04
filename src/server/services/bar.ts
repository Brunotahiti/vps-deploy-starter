import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";
import { bpsDiscount, computeLine } from "@/lib/order-calc";
import { addMovement, applyInventory, refreshAvailability } from "./stock";
import { assertOpen, createOrder, getOrder, lockOrder, recalcOrder, settleAfterChange, type Actor } from "./orders";
import { normalizeBarSettings, type BarSettings, type HappyHour } from "./happy-hour";

export { activeHappyHour, isHappyHourOn, normalizeBarSettings, type BarSettings, type HappyHour } from "./happy-hour";
import { Prisma } from "@/generated/prisma/client";

/*
 * Option payante « Bar » : ardoises au comptoir, happy hour automatique, verres offerts tracés,
 * fiches cocktails (doses au cl, décomptées de la cave à chaque vente), cave du bar (bouteilles, inventaire,
 * casse) et rapport du bar. La cave et les doses s'appuient sur le moteur de stock (ingrédients, recettes).
 */

const n = (d: Prisma.Decimal | number | string | null | undefined) => (d === null || d === undefined ? 0 : Number(d));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

// ------------------------------------------------------------------ Happy hour
export async function barSettings(establishmentId: string): Promise<BarSettings> {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { settings: true } });
  return normalizeBarSettings(((est.settings ?? {}) as { bar?: unknown }).bar);
}

export async function updateBarSettings(actor: Actor, input: { happyHours: HappyHour[] }) {
  const [categories, products] = await Promise.all([
    prisma.category.findMany({ where: { establishmentId: actor.establishmentId }, select: { id: true } }),
    prisma.product.findMany({ where: { establishmentId: actor.establishmentId, id: { in: input.happyHours.flatMap((h) => h.productIds ?? []) } }, select: { id: true } }),
  ]);
  const knownCats = new Set(categories.map((c) => c.id)), knownProducts = new Set(products.map((p) => p.id));
  for (const h of input.happyHours) {
    if (h.start === h.end) throw new ApiError(400, "BAD_HOURS", `${h.name} : l'heure de fin doit différer de l'heure de début`);
    if (!h.days.length) throw new ApiError(400, "BAD_DAYS", `${h.name} : choisissez au moins un jour`);
    if (!h.categoryIds.length && !(h.productIds ?? []).length) throw new ApiError(400, "BAD_TARGET", `${h.name} : choisissez les boissons concernées (catégories ou boissons)`);
    if (h.categoryIds.some((c) => !knownCats.has(c))) throw new ApiError(400, "BAD_CATEGORY", "Catégorie inconnue");
    if ((h.productIds ?? []).some((p) => !knownProducts.has(p))) throw new ApiError(400, "BAD_PRODUCT", "Boisson inconnue");
  }
  const next = normalizeBarSettings({ happyHours: input.happyHours });
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { settings: true } });
  const current = (est.settings ?? {}) as Record<string, unknown>;
  await prisma.establishment.update({ where: { id: actor.establishmentId }, data: { settings: { ...current, bar: { ...((current.bar as object) ?? {}), ...next } } as object } });
  await audit({ ...actor, action: "bar.settings", entityType: "establishment", entityId: actor.establishmentId, newValue: next });
  publish("catalog.updated", actor.establishmentId, { happyHour: true });
  return next;
}

// ------------------------------------------------------------------ Verres offerts
/** Article offert (motif obligatoire, auteur tracé) : la ligne passe à 0, visible sur le ticket et dans le rapport du bar. */
export async function offerItem(actor: Actor, orderId: string, itemId: string, reason: string) {
  const note = reason.trim();
  if (note.length < 2) throw new ApiError(400, "REASON_REQUIRED", "Indiquez pourquoi l'article est offert");
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  const item = order.items.find((i) => i.id === itemId);
  if (!item || item.status === "VOIDED") throw new ApiError(404, "NOT_FOUND", "Article introuvable");
  if (!item.productId || item.parentItemId) throw new ApiError(400, "NOT_OFFERABLE", "Seul un article de la carte peut être offert (pour une formule, faites une remise)");
  if (item.discountKind === "OFFERED") throw new ApiError(409, "ALREADY_OFFERED", "Article déjà offert");
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const discountAmount = bpsDiscount(item.unitPrice, item.modifiersTotal, item.quantity, 10000);
    const calc = computeLine({ quantity: item.quantity, unitPrice: item.unitPrice, modifiersTotal: item.modifiersTotal, discountAmount, taxRateBps: item.taxRateBps });
    await tx.orderItem.update({ where: { id: item.id }, data: { discountAmount, discountKind: "OFFERED", discountBps: 10000, discountNote: note.slice(0, 120), discountById: actor.authorizedById ?? actor.userId, lineTotal: calc.lineTotal, taxAmount: calc.taxAmount } });
    await recalcOrder(tx, orderId);
    // Pas de clôture automatique à 0 : offrir le premier verre d'une ardoise ne la ferme pas (clôture explicite : closeOffered)
    await settleAfterChange(tx, actor, orderId);
    await audit({ ...actor, action: "order.item_offered", entityType: "order", entityId: orderId, newValue: { itemId, name: item.name, quantity: item.quantity, value: discountAmount }, reason: note }, tx);
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  return getOrder(actor.establishmentId, orderId);
}

/** Annule l'offre : l'article retrouve son prix. */
export async function unofferItem(actor: Actor, orderId: string, itemId: string) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  const item = order.items.find((i) => i.id === itemId);
  if (!item || item.discountKind !== "OFFERED") throw new ApiError(404, "NOT_FOUND", "Article offert introuvable");
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    const calc = computeLine({ quantity: item.quantity, unitPrice: item.unitPrice, modifiersTotal: item.modifiersTotal, discountAmount: 0, taxRateBps: item.taxRateBps });
    await tx.orderItem.update({ where: { id: item.id }, data: { discountAmount: 0, discountKind: null, discountBps: null, discountNote: null, discountById: null, lineTotal: calc.lineTotal, taxAmount: calc.taxAmount } });
    await recalcOrder(tx, orderId);
    await audit({ ...actor, action: "order.item_unoffered", entityType: "order", entityId: orderId, newValue: { itemId, name: item.name } }, tx);
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  return getOrder(actor.establishmentId, orderId);
}

/** Addition entièrement offerte (total 0, rien d'encaissé) : clôture explicite. */
export async function closeOffered(actor: Actor, orderId: string) {
  const order = await getOrder(actor.establishmentId, orderId);
  assertOpen(order);
  const active = order.items.filter((i) => i.status !== "VOIDED" && !i.parentItemId);
  if (!active.length || order.total !== 0 || order.paidTotal !== 0) throw new ApiError(409, "NOT_ZERO", "Il reste un montant à encaisser");
  if (!active.every((i) => i.discountKind === "OFFERED" || i.lineTotal === 0)) throw new ApiError(409, "NOT_OFFERED", "Tous les articles ne sont pas offerts");
  await prisma.$transaction(async (tx) => {
    await lockOrder(tx, orderId);
    await settleAfterChange(tx, actor, orderId, { closeIfZero: true });
    await audit({ ...actor, action: "order.closed_offered", entityType: "order", entityId: orderId }, tx);
  });
  publish("order.updated", actor.establishmentId, { orderId, tableId: order.tableId });
  return getOrder(actor.establishmentId, orderId);
}

// ------------------------------------------------------------------ Ardoises au comptoir
export async function createTab(actor: Actor, input: { id?: string; name: string; customerId?: string | null }) {
  const name = input.name.trim();
  if (name.length < 1) throw new ApiError(400, "NAME_REQUIRED", "Indiquez le nom du client");
  if (input.customerId && !(await prisma.customer.findFirst({ where: { id: input.customerId, organizationId: actor.organizationId }, select: { id: true } }))) throw new ApiError(400, "BAD_CUSTOMER", "Client inconnu");
  const order = await createOrder(actor, { id: input.id, type: "COUNTER", customerName: name.slice(0, 60), isTab: true });
  if (input.customerId) await prisma.order.update({ where: { id: order.id }, data: { customerId: input.customerId } });
  await audit({ ...actor, action: "bar.tab_open", entityType: "order", entityId: order.id, newValue: { name } });
  return getOrder(actor.establishmentId, order.id);
}

export async function listTabs(establishmentId: string) {
  const rows = await prisma.order.findMany({
    where: { establishmentId, isTab: true, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] } },
    orderBy: { openedAt: "asc" },
    select: { id: true, number: true, customerName: true, total: true, paidTotal: true, status: true, openedAt: true, updatedAt: true, server: { select: { firstName: true, displayName: true } }, _count: { select: { items: { where: { status: { not: "VOIDED" }, parentItemId: null } } } } },
  });
  return rows.map(({ _count, server, ...r }) => ({ ...r, items: _count.items, server: server ? server.displayName || server.firstName : null }));
}

// ------------------------------------------------------------------ Fiches cocktails
export type BarSpec = { glass: string | null; garnish: string | null; method: string | null };
const specOf = (raw: unknown): BarSpec | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return { glass: s(r.glass), garnish: s(r.garnish), method: s(r.method) };
};

/** Boissons de la carte (produits envoyés au bar) avec leur fiche : verre, garniture, préparation et doses. */
export async function listCocktails(establishmentId: string) {
  const products = await prisma.product.findMany({
    // Boissons : produits envoyés au bar, ou déjà dotés d'une fiche (pas les plats qui utilisent un ingrédient de la cave)
    where: { establishmentId, isActive: true, OR: [{ barSpec: { not: Prisma.AnyNull } }, { kitchenStation: { name: { contains: "bar", mode: "insensitive" } } }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true, priceTtc: true, imageUrl: true, barSpec: true, category: { select: { id: true, name: true } }, recipeLines: { where: { ingredient: { barKind: { not: null } } }, select: { quantity: true, ingredient: { select: { id: true, name: true, unit: true, avgCost: true } } } } },
  });
  return products.map((p) => {
    const doses = p.recipeLines.map((l) => ({ ingredientId: l.ingredient.id, name: l.ingredient.name, unit: l.ingredient.unit, quantity: n(l.quantity), cost: Math.round(n(l.quantity) * l.ingredient.avgCost) }));
    const spec = specOf(p.barSpec);
    return { id: p.id, name: p.name, priceTtc: p.priceTtc, imageUrl: p.imageUrl, category: p.category, spec, doses, doseCost: doses.reduce((a, d) => a + d.cost, 0), hasCard: !!spec || doses.length > 0 };
  });
}

export async function setCocktail(actor: Actor, productId: string, input: { glass?: string | null; garnish?: string | null; method?: string | null; doses: { ingredientId: string; quantity: number }[] }) {
  const product = await prisma.product.findFirst({ where: { id: productId, establishmentId: actor.establishmentId }, select: { id: true, name: true } });
  if (!product) throw new ApiError(404, "NOT_FOUND", "Produit introuvable");
  const doses = input.doses.filter((d) => d.quantity > 0);
  const ids = [...new Set(doses.map((d) => d.ingredientId))];
  if (ids.length !== doses.length) throw new ApiError(400, "DUPLICATE_DOSE", "Une même bouteille apparaît deux fois dans la fiche");
  const bottles = await prisma.ingredient.findMany({ where: { id: { in: ids }, establishmentId: actor.establishmentId, barKind: { not: null } }, select: { id: true } });
  if (bottles.length !== ids.length) throw new ApiError(400, "BAD_INGREDIENT", "Boisson inconnue dans la cave du bar");
  const spec = specOf(input);
  await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: productId }, data: { barSpec: spec && (spec.glass || spec.garnish || spec.method) ? spec : Prisma.DbNull } });
    // Les doses de la cave remplacent les précédentes ; les autres lignes de recette (cuisine) sont conservées
    const previous = await tx.recipeLine.findMany({ where: { productId, ingredient: { barKind: { not: null } } }, select: { ingredientId: true } });
    await tx.recipeLine.deleteMany({ where: { productId, ingredientId: { in: previous.map((p) => p.ingredientId) } } });
    if (doses.length) await tx.recipeLine.createMany({ data: doses.map((d) => ({ productId, ingredientId: d.ingredientId, quantity: round3(d.quantity) })), skipDuplicates: false });
    await refreshAvailability(tx, actor.establishmentId, [...ids, ...previous.map((p) => p.ingredientId)], [productId]);
    await audit({ ...actor, action: "bar.cocktail", entityType: "product", entityId: productId, newValue: { spec, doses: doses.length } }, tx);
  });
  publish("catalog.updated", actor.establishmentId, { productId });
  return (await listCocktails(actor.establishmentId)).find((c) => c.id === productId) ?? null;
}

// ------------------------------------------------------------------ Cave du bar
export const BAR_KINDS = ["spirit", "wine", "beer", "soft", "syrup", "other"] as const;
export type BarKind = (typeof BAR_KINDS)[number];

/** Quantité d'une bouteille dans l'unité de stock : cl → contenance en cl ; pièce → 1. */
const perBottle = (i: { unit: string; bottleMl: number | null }) => (i.unit === "cl" && i.bottleMl ? i.bottleMl / 10 : i.unit === "ml" && i.bottleMl ? i.bottleMl : 1);

export async function listCellar(establishmentId: string) {
  const rows = await prisma.ingredient.findMany({ where: { establishmentId, isActive: true, barKind: { not: null } }, orderBy: [{ barKind: "asc" }, { name: "asc" }] });
  return rows.map((i) => {
    const stockQty = n(i.stockQty), stockMin = n(i.stockMin), per = perBottle(i);
    return {
      id: i.id, name: i.name, barKind: i.barKind as BarKind, unit: i.unit, bottleMl: i.bottleMl, stockQty, stockMin,
      bottles: round3(stockQty / per), minBottles: round3(stockMin / per), bottleCost: Math.round(i.avgCost * per), unitCost: i.avgCost,
      value: Math.round(Math.max(0, stockQty) * i.avgCost), low: stockQty <= stockMin, out: stockQty <= 0,
    };
  });
}

async function cellarBottle(establishmentId: string, id: string) {
  const i = await prisma.ingredient.findFirst({ where: { id, establishmentId, barKind: { not: null } } });
  if (!i) throw new ApiError(404, "NOT_FOUND", "Boisson introuvable dans la cave du bar");
  return i;
}

/** Boisson de la cave : au cl (bouteille de 70 cl…) ou à la pièce (bière en bouteille, canette). Seuil et prix par bouteille. */
export async function upsertBottle(actor: Actor, input: { id?: string; name: string; barKind: BarKind; unit: "cl" | "pce"; bottleMl?: number | null; minBottles?: number; bottleCost?: number }) {
  if (input.unit === "cl" && !(input.bottleMl && input.bottleMl >= 50)) throw new ApiError(400, "BOTTLE_SIZE", "Indiquez la contenance de la bouteille (en cl)");
  const bottleMl = input.unit === "cl" ? input.bottleMl! : null;
  const per = perBottle({ unit: input.unit, bottleMl });
  const data = {
    name: input.name.trim(), barKind: input.barKind, unit: input.unit, bottleMl,
    ...(input.minBottles !== undefined ? { stockMin: round3(input.minBottles * per) } : {}),
    ...(input.bottleCost !== undefined ? { avgCost: Math.round(input.bottleCost / per), lastCost: Math.round(input.bottleCost / per) } : {}),
  };
  if (input.id) {
    const existing = await prisma.ingredient.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Boisson introuvable");
    if (existing.unit !== input.unit && n(existing.stockQty) !== 0) throw new ApiError(409, "UNIT_LOCKED", "Unité non modifiable tant qu'il reste du stock : faites d'abord l'inventaire à zéro");
    const row = await prisma.ingredient.update({ where: { id: input.id }, data });
    await audit({ ...actor, action: "bar.bottle_update", entityType: "ingredient", entityId: row.id, newValue: data });
    return (await listCellar(actor.establishmentId)).find((b) => b.id === row.id)!;
  }
  const row = await prisma.ingredient.create({ data: { establishmentId: actor.establishmentId, ...data, stockMin: data.stockMin ?? 0, avgCost: data.avgCost ?? 0, lastCost: data.lastCost ?? 0 } });
  await audit({ ...actor, action: "bar.bottle_create", entityType: "ingredient", entityId: row.id, newValue: data });
  return (await listCellar(actor.establishmentId)).find((b) => b.id === row.id)!;
}

/** Réception de bouteilles (achat) : le stock et le coût moyen se mettent à jour. */
export async function receiveBottles(actor: Actor, id: string, input: { bottles: number; bottleCost?: number | null }) {
  const i = await cellarBottle(actor.establishmentId, id);
  if (!(input.bottles > 0)) throw new ApiError(400, "BAD_QUANTITY", "Nombre de bouteilles invalide");
  const per = perBottle(i);
  await addMovement(actor, { ingredientId: id, kind: "PURCHASE", quantity: round3(input.bottles * per), unitCost: input.bottleCost ? Math.round(input.bottleCost / per) : null, reason: "Réception au bar" });
  return (await listCellar(actor.establishmentId)).find((b) => b.id === id)!;
}

/** Casse ou perte au bar (bouteille cassée, verre renversé, périmé) : en bouteilles ou en cl. */
export async function recordBreakage(actor: Actor, id: string, input: { quantity: number; per: "bottle" | "unit"; reason: string }) {
  const i = await cellarBottle(actor.establishmentId, id);
  if (!(input.quantity > 0)) throw new ApiError(400, "BAD_QUANTITY", "Quantité invalide");
  if (input.reason.trim().length < 2) throw new ApiError(400, "REASON_REQUIRED", "Indiquez le motif de la casse ou de la perte");
  const qty = round3(input.per === "bottle" ? input.quantity * perBottle(i) : input.quantity);
  await addMovement(actor, { ingredientId: id, kind: "BREAKAGE", quantity: qty, reason: input.reason.trim() });
  return (await listCellar(actor.establishmentId)).find((b) => b.id === id)!;
}

/** Inventaire du bar : bouteilles pleines + entamée (¼, ½, ¾) ; l'écart est tracé. */
export async function barInventory(actor: Actor, counts: { id: string; bottles: number }[]) {
  const bottles = await prisma.ingredient.findMany({ where: { id: { in: counts.map((c) => c.id) }, establishmentId: actor.establishmentId, barKind: { not: null } } });
  if (bottles.length !== new Set(counts.map((c) => c.id)).size) throw new ApiError(400, "BAD_INGREDIENT", "Boisson inconnue dans la cave du bar");
  const res = await applyInventory(actor, counts.map((c) => ({ ingredientId: c.id, countedQty: round3(Math.max(0, c.bottles) * perBottle(bottles.find((b) => b.id === c.id)!)) })), "Inventaire du bar");
  return { ...res, cellar: await listCellar(actor.establishmentId) };
}

// ------------------------------------------------------------------ Rapport du bar
export async function barReport(establishmentId: string, timezone: string, fromDay: string, toDay: string) {
  const from = startOfLocalDay(fromDay, timezone), to = endOfLocalDay(toDay, timezone);
  const paid = { establishmentId, status: "PAID" as const, closedAt: { gte: from, lt: to } };
  const stations = await prisma.kitchenStation.findMany({ where: { establishmentId, name: { contains: "bar", mode: "insensitive" } }, select: { id: true } });
  const [drinks, discounted, tabs, losses] = await Promise.all([
    prisma.orderItem.findMany({ where: { order: paid, status: { not: "VOIDED" }, kitchenStationId: { in: stations.map((s) => s.id) } }, select: { name: true, quantity: true, lineTotal: true } }),
    prisma.orderItem.findMany({ where: { order: paid, status: { not: "VOIDED" }, discountKind: { in: ["HAPPY_HOUR", "OFFERED"] } }, select: { name: true, quantity: true, discountAmount: true, discountKind: true, discountNote: true, discountById: true } }),
    prisma.order.aggregate({ where: { ...paid, isTab: true }, _count: true, _sum: { total: true } }),
    prisma.inventoryMovement.findMany({ where: { establishmentId, kind: { in: ["BREAKAGE", "LOSS"] }, createdAt: { gte: from, lt: to }, ingredient: { barKind: { not: null } } }, orderBy: { createdAt: "desc" }, select: { quantity: true, unitCost: true, reason: true, createdAt: true, ingredient: { select: { name: true, unit: true, bottleMl: true } }, user: { select: { firstName: true, displayName: true } } } }),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(discounted.map((d) => d.discountById).filter((x): x is string => !!x))] } }, select: { id: true, firstName: true, displayName: true } });
  const byName = new Map<string, { name: string; quantity: number; revenue: number }>();
  for (const d of drinks) { const r = byName.get(d.name) ?? { name: d.name, quantity: 0, revenue: 0 }; r.quantity += d.quantity; r.revenue += d.lineTotal; byName.set(d.name, r); }
  const hh = discounted.filter((d) => d.discountKind === "HAPPY_HOUR");
  const offered = discounted.filter((d) => d.discountKind === "OFFERED");
  const group = <K extends string>(rows: typeof offered, key: (r: (typeof offered)[number]) => K) => {
    const m = new Map<K, { key: K; count: number; value: number }>();
    for (const r of rows) { const k = key(r); const g = m.get(k) ?? { key: k, count: 0, value: 0 }; g.count += r.quantity; g.value += r.discountAmount; m.set(k, g); }
    return [...m.values()].sort((a, b) => b.value - a.value);
  };
  const userName = (id: string | null) => { const u = users.find((x) => x.id === id); return u ? u.displayName || u.firstName : "—"; };
  const cellar = await listCellar(establishmentId);
  return {
    from: fromDay, to: toDay,
    drinks: { quantity: drinks.reduce((a, d) => a + d.quantity, 0), revenue: drinks.reduce((a, d) => a + d.lineTotal, 0), top: [...byName.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10) },
    happyHour: { quantity: hh.reduce((a, d) => a + d.quantity, 0), discount: hh.reduce((a, d) => a + d.discountAmount, 0) },
    offered: { quantity: offered.reduce((a, d) => a + d.quantity, 0), value: offered.reduce((a, d) => a + d.discountAmount, 0), byReason: group(offered, (r) => r.discountNote ?? "—"), byPerson: group(offered, (r) => userName(r.discountById)) },
    tabs: { count: tabs._count, total: tabs._sum.total ?? 0, average: tabs._count ? Math.round((tabs._sum.total ?? 0) / tabs._count) : 0 },
    losses: {
      value: losses.reduce((a, l) => a + Math.round(-n(l.quantity) * (l.unitCost ?? 0)), 0),
      rows: losses.map((l) => ({ name: l.ingredient.name, unit: l.ingredient.unit, quantity: -n(l.quantity), bottles: l.ingredient.unit === "cl" && l.ingredient.bottleMl ? round3((-n(l.quantity) * 10) / l.ingredient.bottleMl) : null, value: Math.round(-n(l.quantity) * (l.unitCost ?? 0)), reason: l.reason, at: l.createdAt, by: l.user ? l.user.displayName || l.user.firstName : null })),
    },
    cellar: { value: cellar.reduce((a, c) => a + c.value, 0), low: cellar.filter((c) => c.low) },
  };
}
