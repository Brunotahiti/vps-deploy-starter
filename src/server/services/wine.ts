import { prisma, type Tx } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import {
  DEFAULT_SERVING_ML, WINE_COLORS, WINE_COLOR_LABEL, WINE_COLOR_PLURAL, WINE_REMOVALS, WINE_SERVINGS, clLabel, drinkWindow, keepDaysOf, servingProductName, wineLabel,
  type WineColor, type WineRemoval, type WineServing,
} from "@/lib/wine";
import { addMovement, applyInventory, refreshAvailability } from "./stock";
import type { Actor } from "./orders";
import type { Prisma } from "@/generated/prisma/client";

/*
 * Option payante « Cave à vin » : fiches vins (une cuvée d'un millésime), cave par emplacement (stock en cl, affiché
 * en bouteilles), vin au verre et en carafe (bouteilles ouvertes suivies), formats de vente reliés à la carte,
 * accords mets-vins proposés à la caisse, carte des vins (écran, PDF, site) et rapport des ventes et marges.
 * Le stock s'appuie sur le moteur de stock : chaque vin a son ingrédient (unité cl), décompté par la recette des produits.
 */

const n = (d: Prisma.Decimal | number | string | null | undefined) => (d === null || d === undefined ? 0 : Number(d));
const round1 = (x: number) => Math.round(x * 10) / 10;
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const DAY = 86_400_000;

const wineInclude = {
  ingredient: { select: { id: true, stockQty: true, stockMin: true, avgCost: true, lastCost: true, bottleMl: true } },
  products: { select: { id: true, name: true, priceTtc: true, isActive: true, isAvailable: true, autoUnavailable: true, wineServing: true, wineServingMl: true, categoryId: true, taxRateId: true, kitchenStationId: true }, orderBy: { priceTtc: "asc" } },
  openBottles: { where: { closedAt: null }, orderBy: { openedAt: "asc" } },
} satisfies Prisma.WineInclude;
type WineRow = Prisma.WineGetPayload<{ include: typeof wineInclude }>;

/** Fiche + stock calculé : bouteilles pleines, bouteilles ouvertes, valeur, seuil, apogée, formats de vente. */
function present(w: WineRow, now = new Date()) {
  const bottleMl = w.ingredient.bottleMl ?? 750;
  const bottleCl = bottleMl / 10;
  const stockCl = n(w.ingredient.stockQty), minCl = n(w.ingredient.stockMin);
  const openMl = w.openBottles.reduce((a, b) => a + b.remainingMl, 0);
  const bottles = Math.max(0, round1((stockCl - openMl / 10) / bottleCl));
  const minBottles = round1(minCl / bottleCl);
  const keepDays = keepDaysOf(w);
  const glassMl = w.products.find((p) => p.isActive && p.wineServing === "GLASS")?.wineServingMl ?? null;
  return {
    id: w.id, name: w.name, producer: w.producer, appellation: w.appellation, region: w.region, country: w.country, color: w.color as WineColor,
    vintage: w.vintage, grapes: w.grapes, abv: w.abv, isOrganic: w.isOrganic, tastingNotes: w.tastingNotes, pairingNotes: w.pairingNotes,
    servingTemp: w.servingTemp, drinkFrom: w.drinkFrom, drinkUntil: w.drinkUntil, drinkWindow: drinkWindow(w, now.getFullYear()), location: w.location,
    imageUrl: w.imageUrl, keepDays, customKeepDays: w.keepDays, pairedProductIds: w.pairedProductIds, showOnList: w.showOnList, isActive: w.isActive,
    label: wineLabel(w), ingredientId: w.ingredientId, bottleMl,
    stockCl, bottles, minBottles, low: minBottles > 0 ? bottles <= minBottles : bottles <= 0, out: stockCl <= 0,
    bottleCost: Math.round(w.ingredient.avgCost * bottleCl), lastBottleCost: Math.round(w.ingredient.lastCost * bottleCl), value: Math.round(Math.max(0, stockCl) * w.ingredient.avgCost),
    formats: w.products.filter((p) => p.wineServing).map((p) => ({
      productId: p.id, serving: p.wineServing as WineServing, ml: p.wineServing === "BOTTLE" ? bottleMl : (p.wineServingMl ?? 0), priceTtc: p.priceTtc, isActive: p.isActive,
      available: p.isActive && p.isAvailable && !p.autoUnavailable, categoryId: p.categoryId, taxRateId: p.taxRateId, kitchenStationId: p.kitchenStationId,
    })),
    open: w.openBottles.map((b) => {
      const ageDays = Math.floor((now.getTime() - b.openedAt.getTime()) / DAY);
      return { id: b.id, openedAt: b.openedAt, remainingMl: b.remainingMl, ageDays, overdue: now.getTime() - b.openedAt.getTime() > keepDays * DAY, glassesLeft: glassMl ? Math.floor(b.remainingMl / glassMl) : null };
    }),
  };
}
export type WineView = ReturnType<typeof present>;

/** Sans les prix d'achat ni la valeur de la cave : pour l'équipe qui consulte sans gérer. */
export function withoutCosts<T extends { bottleCost: number; lastBottleCost: number; value: number }>(w: T): T {
  return { ...w, bottleCost: 0, lastBottleCost: 0, value: 0 };
}

export async function listWines(establishmentId: string, opts: { includeInactive?: boolean } = {}) {
  const rows = await prisma.wine.findMany({ where: { establishmentId, ...(opts.includeInactive ? {} : { isActive: true }) }, include: wineInclude, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const order = (c: string) => (WINE_COLORS as readonly string[]).indexOf(c);
  return rows.map((w) => present(w)).sort((a, b) => order(a.color) - order(b.color) || (a.region ?? "").localeCompare(b.region ?? "", "fr") || a.label.localeCompare(b.label, "fr"));
}

async function wineRow(establishmentId: string, id: string, db: Tx | typeof prisma = prisma) {
  const w = await db.wine.findFirst({ where: { id, establishmentId }, include: wineInclude });
  if (!w) throw new ApiError(404, "NOT_FOUND", "Vin introuvable");
  return w;
}

/** Fiche complète : mouvements récents de la cave et plats conseillés. */
export async function getWine(establishmentId: string, id: string) {
  const w = await wineRow(establishmentId, id);
  const [movements, dishes] = await Promise.all([
    prisma.inventoryMovement.findMany({ where: { ingredientId: w.ingredientId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, kind: true, quantity: true, unitCost: true, reason: true, createdAt: true, user: { select: { firstName: true, displayName: true } } } }),
    w.pairedProductIds.length ? prisma.product.findMany({ where: { id: { in: w.pairedProductIds }, establishmentId }, select: { id: true, name: true } }) : [],
  ]);
  const bottleCl = (w.ingredient.bottleMl ?? 750) / 10;
  return {
    ...present(w),
    dishes,
    movements: movements.map((m) => ({ id: m.id, kind: m.kind, cl: n(m.quantity), bottles: round1(n(m.quantity) / bottleCl), reason: m.reason, at: m.createdAt, by: m.user ? m.user.displayName || m.user.firstName : null })),
  };
}

// ------------------------------------------------------------------ Fiches
export type WineInput = {
  name: string; producer?: string | null; appellation?: string | null; region?: string | null; country?: string | null; color: WineColor;
  vintage?: number | null; grapes?: string[]; abv?: number | null; isOrganic?: boolean; tastingNotes?: string | null; pairingNotes?: string | null;
  servingTemp?: string | null; drinkFrom?: number | null; drinkUntil?: number | null; location?: string | null; imageUrl?: string | null;
  keepDays?: number | null; pairedProductIds?: string[]; showOnList?: boolean; isActive?: boolean;
  bottleMl?: number; minBottles?: number; bottleCost?: number;
};

const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

async function assertDishes(establishmentId: string, ids: string[]) {
  if (!ids.length) return;
  const found = await prisma.product.count({ where: { id: { in: ids }, establishmentId, wineId: null } });
  if (found !== new Set(ids).size) throw new ApiError(400, "BAD_PRODUCT", "Plat inconnu dans les accords");
}

export async function upsertWine(actor: Actor, id: string | null, input: WineInput) {
  const name = input.name.trim();
  if (name.length < 1) throw new ApiError(400, "NAME_REQUIRED", "Indiquez le nom du vin (cuvée)");
  if (input.drinkFrom && input.drinkUntil && input.drinkFrom > input.drinkUntil) throw new ApiError(400, "BAD_WINDOW", "L'apogée « de » doit précéder l'apogée « à »");
  const paired = [...new Set(input.pairedProductIds ?? [])];
  await assertDishes(actor.establishmentId, paired);
  const fiche = {
    name, producer: clean(input.producer), appellation: clean(input.appellation), region: clean(input.region), country: clean(input.country), color: input.color,
    vintage: input.vintage ?? null, grapes: (input.grapes ?? []).map((g) => g.trim()).filter(Boolean).slice(0, 12), abv: input.abv ?? null, isOrganic: input.isOrganic ?? false,
    tastingNotes: clean(input.tastingNotes), pairingNotes: clean(input.pairingNotes), servingTemp: clean(input.servingTemp), drinkFrom: input.drinkFrom ?? null, drinkUntil: input.drinkUntil ?? null,
    location: clean(input.location), imageUrl: clean(input.imageUrl), keepDays: input.keepDays ?? null, pairedProductIds: paired,
    ...(input.showOnList !== undefined ? { showOnList: input.showOnList } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
  const label = wineLabel(fiche);

  if (!id) {
    const bottleMl = input.bottleMl ?? 750;
    const bottleCl = bottleMl / 10;
    const created = await prisma.$transaction(async (tx) => {
      // Stock dédié (en cl) : critique, pour que les formats de vente passent en rupture à zéro
      const ing = await tx.ingredient.create({ data: { establishmentId: actor.establishmentId, name: label, unit: "cl", bottleMl, isCritical: true, stockMin: round3((input.minBottles ?? 0) * bottleCl), avgCost: Math.round((input.bottleCost ?? 0) / bottleCl), lastCost: Math.round((input.bottleCost ?? 0) / bottleCl) } });
      const w = await tx.wine.create({ data: { establishmentId: actor.establishmentId, ingredientId: ing.id, ...fiche } });
      await audit({ ...actor, action: "wine.create", entityType: "wine", entityId: w.id, newValue: { label, color: fiche.color } }, tx);
      return w;
    });
    return present(await wineRow(actor.establishmentId, created.id));
  }

  const before = await wineRow(actor.establishmentId, id);
  const bottleMl = input.bottleMl ?? before.ingredient.bottleMl ?? 750;
  if (bottleMl !== before.ingredient.bottleMl && (n(before.ingredient.stockQty) !== 0 || before.openBottles.length)) throw new ApiError(409, "SIZE_LOCKED", "Contenance non modifiable tant qu'il reste du vin en cave : faites d'abord l'inventaire à zéro");
  const bottleCl = bottleMl / 10;
  await prisma.$transaction(async (tx) => {
    await tx.wine.update({ where: { id }, data: fiche });
    const avgCost = input.bottleCost !== undefined ? Math.round(input.bottleCost / bottleCl) : before.ingredient.avgCost;
    await tx.ingredient.update({ where: { id: before.ingredientId }, data: { name: label, bottleMl, ...(input.minBottles !== undefined ? { stockMin: round3(input.minBottles * bottleCl) } : {}), ...(input.bottleCost !== undefined ? { avgCost } : {}) } });
    // Les produits vendus suivent la fiche : nom, coût matière, dose d'une bouteille
    for (const p of before.products.filter((x) => x.wineServing)) {
      const serving = p.wineServing as WineServing;
      const ml = serving === "BOTTLE" ? bottleMl : (p.wineServingMl ?? DEFAULT_SERVING_ML[serving]);
      await tx.product.update({ where: { id: p.id }, data: { name: servingProductName(fiche, serving, ml), costPrice: Math.round((avgCost * ml) / 10), ...(serving === "BOTTLE" ? { wineServingMl: bottleMl } : {}) } });
      if (serving === "BOTTLE") await tx.recipeLine.updateMany({ where: { productId: p.id, ingredientId: before.ingredientId }, data: { quantity: bottleCl } });
    }
    await audit({ ...actor, action: "wine.update", entityType: "wine", entityId: id, newValue: { label } }, tx);
  });
  if (before.products.length) publish("catalog.updated", actor.establishmentId, { wine: id });
  return present(await wineRow(actor.establishmentId, id));
}

/** Retire un vin de la cave : la fiche et ses formats de vente sont désactivés (l'historique reste). */
export async function archiveWine(actor: Actor, id: string) {
  const w = await wineRow(actor.establishmentId, id);
  await prisma.$transaction(async (tx) => {
    await tx.wine.update({ where: { id }, data: { isActive: false } });
    await tx.product.updateMany({ where: { wineId: id }, data: { isActive: false } });
    await tx.ingredient.update({ where: { id: w.ingredientId }, data: { isActive: false } });
    await audit({ ...actor, action: "wine.archive", entityType: "wine", entityId: id, newValue: { label: wineLabel(w) } }, tx);
  });
  publish("catalog.updated", actor.establishmentId, { wine: id });
}

// ------------------------------------------------------------------ Formats de vente (bouteille, verre, carafe)
export type FormatsInput = {
  categoryId?: string | null; taxRateId?: string | null; kitchenStationId?: string | null;
  bottle?: { priceTtc: number } | null; glass?: { priceTtc: number; ml: number } | null; carafe?: { priceTtc: number; ml: number } | null;
};

/** Crée ou met à jour les produits de la carte reliés au vin ; un format retiré est désactivé (ventes passées conservées). */
export async function setFormats(actor: Actor, wineId: string, input: FormatsInput) {
  const w = await wineRow(actor.establishmentId, wineId);
  const est = actor.establishmentId;
  const [cat, tax, station] = await Promise.all([
    input.categoryId ? prisma.category.findFirst({ where: { id: input.categoryId, establishmentId: est } }) : null,
    input.taxRateId ? prisma.taxRate.findFirst({ where: { id: input.taxRateId, establishmentId: est } }) : null,
    input.kitchenStationId ? prisma.kitchenStation.findFirst({ where: { id: input.kitchenStationId, establishmentId: est } }) : null,
  ]);
  if (input.categoryId && !cat) throw new ApiError(400, "BAD_CATEGORY", "Catégorie inconnue");
  if (input.taxRateId && !tax) throw new ApiError(400, "BAD_TAX", "Taux de TVA inconnu");
  if (input.kitchenStationId && !station) throw new ApiError(400, "BAD_STATION", "Poste inconnu");
  const bottleMl = w.ingredient.bottleMl ?? 750;
  for (const [k, f] of [["glass", input.glass], ["carafe", input.carafe]] as const) {
    if (f && !(f.ml >= 50 && f.ml <= 1500)) throw new ApiError(400, "BAD_ML", `${k === "glass" ? "Verre" : "Carafe"} : contenance entre 5 et 150 cl`);
    if (f && f.ml > bottleMl) throw new ApiError(400, "BAD_ML", `${k === "glass" ? "Le verre" : "La carafe"} ne peut pas dépasser la bouteille (${clLabel(bottleMl)})`);
  }
  const wanted: Record<WineServing, { priceTtc: number; ml: number } | null | undefined> = {
    BOTTLE: input.bottle === undefined ? undefined : input.bottle ? { priceTtc: input.bottle.priceTtc, ml: bottleMl } : null,
    GLASS: input.glass, CARAFE: input.carafe,
  };
  const fallbackTax = input.taxRateId ?? w.products.find((p) => p.taxRateId)?.taxRateId ?? (await prisma.taxRate.findFirst({ where: { establishmentId: est, isDefault: true }, select: { id: true } }))?.id ?? null;
  const touched: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const serving of WINE_SERVINGS) {
      const want = wanted[serving];
      if (want === undefined) continue;
      const existing = w.products.find((p) => p.wineServing === serving);
      if (!want) {
        if (existing?.isActive) { await tx.product.update({ where: { id: existing.id }, data: { isActive: false } }); touched.push(existing.id); }
        continue;
      }
      if (!(want.priceTtc >= 0)) throw new ApiError(400, "BAD_PRICE", "Prix invalide");
      const data = {
        name: servingProductName(w, serving, want.ml), priceTtc: Math.round(want.priceTtc), costPrice: Math.round((w.ingredient.avgCost * want.ml) / 10),
        wineServingMl: want.ml, isActive: true,
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.kitchenStationId !== undefined ? { kitchenStationId: input.kitchenStationId } : {}),
        ...(input.taxRateId !== undefined ? { taxRateId: input.taxRateId } : {}),
      };
      if (existing) {
        await tx.product.update({ where: { id: existing.id }, data });
        await tx.recipeLine.upsert({ where: { productId_ingredientId: { productId: existing.id, ingredientId: w.ingredientId } }, update: { quantity: round3(want.ml / 10) }, create: { productId: existing.id, ingredientId: w.ingredientId, quantity: round3(want.ml / 10) } });
        touched.push(existing.id);
      } else {
        const p = await tx.product.create({ data: { establishmentId: est, ...data, categoryId: input.categoryId ?? w.products[0]?.categoryId ?? null, kitchenStationId: input.kitchenStationId ?? w.products[0]?.kitchenStationId ?? null, taxRateId: fallbackTax, wineId, wineServing: serving, imageUrl: w.imageUrl, description: w.tastingNotes?.slice(0, 300) ?? null, recipeLines: { create: [{ ingredientId: w.ingredientId, quantity: round3(want.ml / 10) }] } } });
        touched.push(p.id);
      }
    }
    await refreshAvailability(tx, est, [w.ingredientId], touched);
    await audit({ ...actor, action: "wine.formats", entityType: "wine", entityId: wineId, newValue: { bottle: wanted.BOTTLE ?? null, glass: wanted.GLASS ?? null, carafe: wanted.CARAFE ?? null } }, tx);
  });
  publish("catalog.updated", est, { wine: wineId });
  return present(await wineRow(est, wineId));
}

// ------------------------------------------------------------------ Cave : réceptions, sorties, inventaire
export async function receiveWine(actor: Actor, id: string, input: { bottles: number; bottleCost?: number | null; note?: string | null }) {
  const w = await wineRow(actor.establishmentId, id);
  if (!(input.bottles > 0) || !Number.isInteger(input.bottles)) throw new ApiError(400, "BAD_QUANTITY", "Nombre de bouteilles invalide");
  const bottleCl = (w.ingredient.bottleMl ?? 750) / 10;
  await addMovement(actor, { ingredientId: w.ingredientId, kind: "PURCHASE", quantity: round3(input.bottles * bottleCl), unitCost: input.bottleCost ? Math.round(input.bottleCost / bottleCl) : null, reason: ["Réception cave à vin", clean(input.note)].filter(Boolean).join(" · ") });
  if (input.bottleCost) await syncCost(actor.establishmentId, id);
  return present(await wineRow(actor.establishmentId, id));
}

/** Le coût matière des formats de vente suit le coût moyen de la bouteille. */
async function syncCost(establishmentId: string, wineId: string) {
  const w = await wineRow(establishmentId, wineId);
  for (const p of w.products.filter((x) => x.wineServing)) {
    const ml = p.wineServing === "BOTTLE" ? (w.ingredient.bottleMl ?? 750) : (p.wineServingMl ?? 0);
    await prisma.product.update({ where: { id: p.id }, data: { costPrice: Math.round((w.ingredient.avgCost * ml) / 10) } });
  }
}

/** Sortie de cave hors vente : casse, perte (bouchonné), dégustation ; motif obligatoire. */
export async function removeWine(actor: Actor, id: string, input: { bottles: number; kind: WineRemoval; reason: string }) {
  const w = await wineRow(actor.establishmentId, id);
  if (!(input.bottles > 0)) throw new ApiError(400, "BAD_QUANTITY", "Nombre de bouteilles invalide");
  const reason = input.reason.trim();
  if (reason.length < 2) throw new ApiError(400, "REASON_REQUIRED", "Indiquez le motif de la sortie");
  const bottleCl = (w.ingredient.bottleMl ?? 750) / 10;
  await addMovement(actor, { ingredientId: w.ingredientId, kind: input.kind, quantity: round3(input.bottles * bottleCl), reason: `${WINE_REMOVALS[input.kind]} : ${reason}` });
  return present(await wineRow(actor.establishmentId, id));
}

/** Inventaire de la cave : bouteilles pleines comptées ; les bouteilles ouvertes gardent leur niveau. */
export async function wineInventory(actor: Actor, counts: { id: string; bottles: number }[], location?: string | null) {
  const wines = await prisma.wine.findMany({ where: { id: { in: counts.map((c) => c.id) }, establishmentId: actor.establishmentId }, include: { ingredient: { select: { bottleMl: true } }, openBottles: { where: { closedAt: null }, select: { remainingMl: true } } } });
  if (wines.length !== new Set(counts.map((c) => c.id)).size) throw new ApiError(400, "BAD_WINE", "Vin inconnu dans la cave");
  const lines = counts.map((c) => {
    const w = wines.find((x) => x.id === c.id)!;
    const openCl = w.openBottles.reduce((a, b) => a + b.remainingMl, 0) / 10;
    return { ingredientId: w.ingredientId, countedQty: round3(Math.max(0, c.bottles) * ((w.ingredient.bottleMl ?? 750) / 10) + openCl) };
  });
  const res = await applyInventory(actor, lines, location ? `Inventaire de la cave · ${location}` : "Inventaire de la cave");
  return { ...res, wines: await listWines(actor.establishmentId) };
}

// ------------------------------------------------------------------ Vin au verre : bouteilles ouvertes
export async function listOpenBottles(establishmentId: string) {
  const wines = await listWines(establishmentId);
  return wines.flatMap((w) => w.open.map((b) => ({ ...b, wineId: w.id, label: w.label, color: w.color, keepDays: w.keepDays, bottleMl: w.bottleMl, glass: w.formats.find((f) => f.serving === "GLASS" && f.isActive) ?? null })))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || +a.openedAt - +b.openedAt);
}

/** Ouvre une bouteille pour le service au verre (sans vente) : le stock ne bouge pas, le suivi commence. */
export async function openBottle(actor: Actor, wineId: string) {
  const w = await wineRow(actor.establishmentId, wineId);
  const bottleMl = w.ingredient.bottleMl ?? 750;
  const openMl = w.openBottles.reduce((a, b) => a + b.remainingMl, 0);
  if (n(w.ingredient.stockQty) * 10 - openMl < bottleMl - 0.001) throw new ApiError(409, "NO_BOTTLE", "Plus de bouteille pleine en cave pour ce vin");
  const b = await prisma.wineOpenBottle.create({ data: { establishmentId: actor.establishmentId, wineId, openedById: actor.userId, remainingMl: bottleMl } });
  await audit({ ...actor, action: "wine.open", entityType: "wine", entityId: wineId, newValue: { bottleId: b.id } });
  publish("catalog.updated", actor.establishmentId, { wineOpen: wineId });
  return b;
}

async function openRow(establishmentId: string, id: string) {
  const b = await prisma.wineOpenBottle.findFirst({ where: { id, establishmentId, closedAt: null }, include: { wine: { select: { id: true, ingredientId: true, name: true, producer: true, vintage: true } } } });
  if (!b) throw new ApiError(404, "NOT_FOUND", "Bouteille ouverte introuvable");
  return b;
}

/** Jette la fin d'une bouteille ouverte (trop ancienne, abîmée) : la quantité jetée sort du stock comme perte. */
export async function discardOpenBottle(actor: Actor, id: string, reason?: string | null) {
  const b = await openRow(actor.establishmentId, id);
  await prisma.wineOpenBottle.update({ where: { id }, data: { closedAt: new Date(), closedReason: "DISCARDED", discardedMl: b.remainingMl, closedById: actor.userId } });
  if (b.remainingMl > 0) await addMovement(actor, { ingredientId: b.wine.ingredientId, kind: "LOSS", quantity: round3(b.remainingMl / 10), reason: `Fin de bouteille ouverte jetée${clean(reason) ? ` : ${clean(reason)}` : ""}` });
  return { ok: true };
}

/** Corrige le niveau d'une bouteille ouverte (estimation au comptoir) ; l'écart est tracé dans le stock. */
export async function adjustOpenBottle(actor: Actor, id: string, remainingMl: number) {
  const b = await openRow(actor.establishmentId, id);
  const w = await wineRow(actor.establishmentId, b.wine.id);
  const max = w.ingredient.bottleMl ?? 750;
  const next = Math.round(Math.min(max, Math.max(0, remainingMl)));
  const diff = next - b.remainingMl;
  if (diff === 0) return { ok: true };
  await prisma.wineOpenBottle.update({ where: { id }, data: { remainingMl: next, ...(next === 0 ? { closedAt: new Date(), closedReason: "FINISHED", closedById: actor.userId } : {}) } });
  await addMovement(actor, { ingredientId: b.wine.ingredientId, kind: diff < 0 ? "LOSS" : "ADJUSTMENT", quantity: round3(Math.abs(diff) / 10), reason: "Niveau d'une bouteille ouverte corrigé" });
  return { ok: true };
}

// ------------------------------------------------------------------ Accords mets-vins
/** Pour chaque plat de la carte : les vins conseillés et leurs formats en vente (pour la caisse). */
export async function pairings(establishmentId: string) {
  const wines = await listWines(establishmentId);
  const map: Record<string, { wineId: string; label: string; color: WineColor; formats: { productId: string; serving: WineServing; ml: number; priceTtc: number; available: boolean }[] }[]> = {};
  for (const w of wines) {
    const formats = w.formats.filter((f) => f.isActive).map(({ productId, serving, ml, priceTtc, available }) => ({ productId, serving, ml, priceTtc, available }));
    if (!formats.length) continue;
    for (const dish of w.pairedProductIds) (map[dish] ??= []).push({ wineId: w.id, label: w.label, color: w.color, formats });
  }
  return map;
}

// ------------------------------------------------------------------ Carte des vins
export type WineSettings = { showOnSite: boolean; listTitle: string; listIntro: string; hideOutOfStock: boolean };
export function normalizeWineSettings(raw: unknown): WineSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    showOnSite: r.showOnSite === true,
    listTitle: typeof r.listTitle === "string" && r.listTitle.trim() ? r.listTitle.trim().slice(0, 60) : "Carte des vins",
    listIntro: typeof r.listIntro === "string" ? r.listIntro.trim().slice(0, 400) : "",
    hideOutOfStock: r.hideOutOfStock !== false,
  };
}

export async function wineSettings(establishmentId: string) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { settings: true } });
  return normalizeWineSettings(((est.settings ?? {}) as { wine?: unknown }).wine);
}

export async function updateWineSettings(actor: Actor, input: Partial<WineSettings>) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { settings: true } });
  const current = (est.settings ?? {}) as Record<string, unknown>;
  const next = normalizeWineSettings({ ...normalizeWineSettings(current.wine), ...input });
  await prisma.establishment.update({ where: { id: actor.establishmentId }, data: { settings: { ...current, wine: next } as object } });
  await audit({ ...actor, action: "wine.settings", entityType: "establishment", entityId: actor.establishmentId, newValue: next });
  return next;
}

/** Carte des vins : rubriques par couleur, puis région ; seulement les vins en vente (et en stock, selon le réglage). */
export async function wineList(establishmentId: string) {
  const [settings, wines] = await Promise.all([wineSettings(establishmentId), listWines(establishmentId)]);
  const sections = WINE_COLORS.map((color) => {
    const items = wines
      .filter((w) => w.color === color && w.showOnList)
      .map((w) => ({ ...w, formats: w.formats.filter((f) => f.isActive && (!settings.hideOutOfStock || f.available)) }))
      .filter((w) => w.formats.length > 0);
    const regions = [...new Set(items.map((w) => w.region ?? ""))];
    return {
      color, title: WINE_COLOR_PLURAL[color],
      regions: regions.map((region) => ({
        region: region || null,
        wines: items.filter((w) => (w.region ?? "") === region).map((w) => ({
          id: w.id, name: w.name, producer: w.producer, appellation: w.appellation, vintage: w.vintage, grapes: w.grapes, isOrganic: w.isOrganic,
          tastingNotes: w.tastingNotes, imageUrl: w.imageUrl, formats: w.formats.map((f) => ({ serving: f.serving, ml: f.ml, priceTtc: f.priceTtc })),
        })),
      })),
    };
  }).filter((s) => s.regions.length > 0);
  return { settings, sections, count: sections.reduce((a, s) => a + s.regions.reduce((b, r) => b + r.wines.length, 0), 0) };
}
export type WineList = Awaited<ReturnType<typeof wineList>>;

/** Carte publique (site du restaurant) : sans coûts ni stocks. */
export async function publicWineList(establishmentId: string) {
  const list = await wineList(establishmentId);
  if (!list.settings.showOnSite || !list.count) return null;
  return { title: list.settings.listTitle, intro: list.settings.listIntro, sections: list.sections };
}

/** Carte des vins en PDF (A4) : à imprimer ou à envoyer. */
export async function wineListPdf(establishmentId: string): Promise<Buffer> {
  const [list, e] = await Promise.all([wineList(establishmentId), prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { name: true, currency: true, city: true } })]);
  const SUBST: Record<string, string> = { "œ": "oe", "Œ": "OE", "’": "'", "‘": "'", "“": "\"", "”": "\"", "—": "-", "–": "-", "…": "...", " ": " " };
  const strip = (ch: string) => ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const safe = (s: string) => [...s].map((ch) => SUBST[ch] ?? (ch.charCodeAt(0) <= 0xff ? ch : /^[\x20-\x7e\xa0-\xff]$/.test(strip(ch)) ? strip(ch) : "")).join("");
  const money = (v: number) => safe(formatMoney(v, e.currency));
  const PDFDocument = (await import("pdfkit")).default;
  const pdf = new PDFDocument({ size: "A4", margins: { top: 50, bottom: 50, left: 56, right: 56 }, info: { Title: `${list.settings.listTitle} — ${e.name}`, Author: e.name } });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => pdf.on("end", () => resolve(Buffer.concat(chunks))));
  const L = 56, W = 483, WINE = "#7f1d1d", INK = "#1c1917", MUTED = "#78716c", PRICE_W = 150;
  const bottom = 841 - 60;
  const ensure = (h: number) => { if (pdf.y + h > bottom) pdf.addPage(); };

  pdf.font("Times-Bold").fontSize(26).fillColor(WINE).text(safe(list.settings.listTitle), L, 60, { width: W, align: "center" });
  pdf.font("Times-Italic").fontSize(13).fillColor(MUTED).text(safe(e.name + (e.city ? ` · ${e.city}` : "")), { width: W, align: "center" });
  if (list.settings.listIntro) { pdf.moveDown(0.8); pdf.font("Times-Roman").fontSize(11).fillColor(INK).text(safe(list.settings.listIntro), { width: W, align: "center" }); }
  pdf.moveDown(1);
  pdf.moveTo(L + W / 2 - 40, pdf.y).lineTo(L + W / 2 + 40, pdf.y).lineWidth(0.8).strokeColor(WINE).stroke();
  pdf.moveDown(1.2);
  if (!list.count) pdf.font("Times-Italic").fontSize(12).fillColor(MUTED).text("Aucun vin en vente pour le moment.", { width: W, align: "center" });

  // En-tête des prix : formats présents sur la carte
  const priceOf = (formats: { serving: WineServing; ml: number; priceTtc: number }[]) =>
    // Un format par ligne (verre, carafe, bouteille), pour que les prix restent lisibles
    formats.map((f) => `${f.serving === "BOTTLE" ? (f.ml === 750 ? "Bouteille" : clLabel(f.ml)) : f.serving === "GLASS" ? `Verre ${clLabel(f.ml)}` : `Carafe ${clLabel(f.ml)}`}   ${money(f.priceTtc)}`).join("\n");

  for (const s of list.sections) {
    ensure(70);
    pdf.moveDown(0.6);
    pdf.font("Times-Bold").fontSize(17).fillColor(WINE).text(safe(s.title.toUpperCase()), L, pdf.y, { width: W, characterSpacing: 1.5 });
    pdf.moveDown(0.3);
    for (const r of s.regions) {
      if (r.region) { ensure(40); pdf.font("Times-Italic").fontSize(12).fillColor(MUTED).text(safe(r.region), L, pdf.y, { width: W }); pdf.moveDown(0.2); }
      for (const w of r.wines) {
        const title = `${w.producer ? `${w.producer}, ` : ""}${w.name}${w.vintage ? ` ${w.vintage}` : ""}${w.isOrganic ? "  (bio)" : ""}`;
        const sub = [w.appellation, w.grapes.length ? w.grapes.join(", ") : null].filter(Boolean).join(" · ");
        const prices = priceOf(w.formats);
        pdf.font("Times-Bold").fontSize(11.5);
        const hTitle = pdf.heightOfString(safe(title), { width: W - PRICE_W - 10 });
        pdf.font("Times-Roman").fontSize(9.5);
        const hSub = sub ? pdf.heightOfString(safe(sub), { width: W - PRICE_W - 10 }) : 0;
        pdf.font("Helvetica").fontSize(9);
        const hPrices = pdf.heightOfString(safe(prices), { width: PRICE_W });
        ensure(Math.max(hTitle + hSub, hPrices) + 14);
        const y = pdf.y;
        pdf.font("Times-Bold").fontSize(11.5).fillColor(INK).text(safe(title), L, y, { width: W - PRICE_W - 10 });
        if (sub) pdf.font("Times-Italic").fontSize(9.5).fillColor(MUTED).text(safe(sub), L, pdf.y, { width: W - PRICE_W - 10 });
        const after = pdf.y;
        pdf.font("Helvetica").fontSize(9).fillColor(INK).text(safe(prices), L + W - PRICE_W, y + 1.5, { width: PRICE_W, align: "right" });
        pdf.y = Math.max(after, pdf.y) + 6;
      }
      pdf.moveDown(0.4);
    }
  }
  pdf.font("Times-Italic").fontSize(8.5).fillColor(MUTED).text("Prix TTC. L'abus d'alcool est dangereux pour la santé, à consommer avec modération.", L, Math.min(pdf.y + 16, bottom), { width: W, align: "center" });
  pdf.end();
  return done;
}

// ------------------------------------------------------------------ Rapport : ventes, marges, pertes
export async function wineReport(establishmentId: string, timezone: string, fromDay: string, toDay: string) {
  const from = startOfLocalDay(fromDay, timezone), to = endOfLocalDay(toDay, timezone);
  const [wines, items, movements, discarded] = await Promise.all([
    listWines(establishmentId, { includeInactive: true }),
    prisma.orderItem.findMany({ where: { order: { establishmentId, status: "PAID", closedAt: { gte: from, lt: to } }, status: { not: "VOIDED" }, product: { wineId: { not: null } } }, select: { quantity: true, lineTotal: true, taxAmount: true, costPrice: true, product: { select: { wineId: true, wineServing: true, wineServingMl: true } } } }),
    prisma.inventoryMovement.findMany({ where: { establishmentId, kind: { in: ["BREAKAGE", "LOSS", "INTERNAL_USE"] }, createdAt: { gte: from, lt: to }, ingredient: { wine: { isNot: null } } }, orderBy: { createdAt: "desc" }, select: { kind: true, quantity: true, unitCost: true, reason: true, createdAt: true, ingredient: { select: { name: true, bottleMl: true } }, user: { select: { firstName: true, displayName: true } } } }),
    prisma.wineOpenBottle.aggregate({ where: { establishmentId, closedReason: "DISCARDED", closedAt: { gte: from, lt: to } }, _sum: { discardedMl: true }, _count: true }),
  ]);
  type Row = { wineId: string; label: string; color: WineColor; bottles: number; glasses: number; carafes: number; ml: number; revenue: number; revenueHt: number; cost: number };
  const byWine = new Map<string, Row>();
  for (const it of items) {
    const wid = it.product!.wineId!;
    const w = wines.find((x) => x.id === wid);
    if (!w) continue;
    const r = byWine.get(wid) ?? { wineId: wid, label: w.label, color: w.color, bottles: 0, glasses: 0, carafes: 0, ml: 0, revenue: 0, revenueHt: 0, cost: 0 };
    const serving = it.product!.wineServing as WineServing;
    if (serving === "BOTTLE") r.bottles += it.quantity; else if (serving === "GLASS") r.glasses += it.quantity; else r.carafes += it.quantity;
    r.ml += (serving === "BOTTLE" ? w.bottleMl : (it.product!.wineServingMl ?? 0)) * it.quantity;
    r.revenue += it.lineTotal; r.revenueHt += it.lineTotal - it.taxAmount; r.cost += it.costPrice * it.quantity;
    byWine.set(wid, r);
  }
  const rows = [...byWine.values()].map((r) => ({ ...r, margin: r.revenueHt - r.cost, coefficient: r.cost > 0 ? Math.round((r.revenueHt / r.cost) * 100) / 100 : null })).sort((a, b) => b.revenue - a.revenue);
  const sum = (k: keyof Row) => rows.reduce((a, r) => a + (r[k] as number), 0);
  const revenueHt = sum("revenueHt"), cost = sum("cost");
  const byColor = WINE_COLORS.map((c) => ({ color: c, label: WINE_COLOR_LABEL[c], revenue: rows.filter((r) => r.color === c).reduce((a, r) => a + r.revenue, 0) })).filter((c) => c.revenue > 0);
  const sold = new Set(rows.map((r) => r.wineId));
  return {
    from: fromDay, to: toDay,
    totals: { revenue: sum("revenue"), revenueHt, cost, margin: revenueHt - cost, coefficient: cost > 0 ? Math.round((revenueHt / cost) * 100) / 100 : null, bottles: sum("bottles"), glasses: sum("glasses"), carafes: sum("carafes"), litres: Math.round(sum("ml") / 100) / 10 },
    rows, byColor,
    losses: {
      value: movements.reduce((a, m) => a + Math.round(-n(m.quantity) * (m.unitCost ?? 0)), 0),
      discardedMl: discarded._sum.discardedMl ?? 0, discardedBottles: discarded._count,
      rows: movements.map((m) => ({ kind: m.kind, name: m.ingredient.name, bottles: round1((-n(m.quantity) * 10) / (m.ingredient.bottleMl ?? 750)), value: Math.round(-n(m.quantity) * (m.unitCost ?? 0)), reason: m.reason, at: m.createdAt, by: m.user ? m.user.displayName || m.user.firstName : null })),
    },
    cellar: {
      value: wines.filter((w) => w.isActive).reduce((a, w) => a + w.value, 0),
      bottles: round1(wines.filter((w) => w.isActive).reduce((a, w) => a + w.bottles, 0)),
      references: wines.filter((w) => w.isActive).length,
      low: wines.filter((w) => w.isActive && w.low && w.minBottles > 0).map((w) => ({ id: w.id, label: w.label, bottles: w.bottles, minBottles: w.minBottles })),
      // Vins dormants : en cave mais pas vendus sur la période
      dormant: wines.filter((w) => w.isActive && w.bottles >= 1 && !sold.has(w.id)).map((w) => ({ id: w.id, label: w.label, bottles: w.bottles, value: w.value })).sort((a, b) => b.value - a.value).slice(0, 15),
    },
  };
}

