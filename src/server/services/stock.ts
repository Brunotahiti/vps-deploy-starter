import { prisma, type Tx } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { localDay } from "@/lib/dates";
import type { Actor } from "./orders";
import type { InventoryMovementKind, Prisma, PurchaseOrderStatus } from "@/generated/prisma/client";

/**
 * Phase 4 — Stock : ingrédients, recettes, décrémentation automatique à l'envoi en cuisine,
 * inventaires et pertes, fournisseurs, bons de commande et réceptions, food cost et alertes.
 * Quantités : Decimal(14,3) en base, nombres côté API. Coûts : entiers XPF par unité d'ingrédient.
 */
const n = (d: Prisma.Decimal | number | string | null | undefined) => (d === null || d === undefined ? 0 : Number(d));
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export const UNITS = ["pce", "g", "kg", "ml", "l", "cl", "portion"] as const;

// ------------------------------------------------------------------ Ingrédients
export async function listIngredients(establishmentId: string, opts: { includeInactive?: boolean } = {}) {
  const rows = await prisma.ingredient.findMany({ where: { establishmentId, ...(opts.includeInactive ? {} : { isActive: true }) }, orderBy: { name: "asc" }, include: { _count: { select: { recipeLines: true, supplierProducts: true } } } });
  return rows.map((i) => ({ ...i, stockQty: n(i.stockQty), stockMin: n(i.stockMin), belowMin: n(i.stockQty) <= n(i.stockMin), value: Math.round(n(i.stockQty) * i.avgCost) }));
}

export async function upsertIngredient(actor: Actor, input: { id?: string; name: string; unit?: string; stockMin?: number; avgCost?: number; isCritical?: boolean; isActive?: boolean }) {
  if (input.id) {
    const existing = await prisma.ingredient.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Ingrédient introuvable");
    const row = await prisma.ingredient.update({ where: { id: input.id }, data: { name: input.name, unit: input.unit, stockMin: input.stockMin, avgCost: input.avgCost, isCritical: input.isCritical, isActive: input.isActive } });
    await audit({ ...actor, action: "ingredient.update", entityType: "ingredient", entityId: row.id, oldValue: { name: existing.name, stockMin: n(existing.stockMin), avgCost: existing.avgCost }, newValue: { name: row.name, stockMin: n(row.stockMin), avgCost: row.avgCost } });
    await prisma.$transaction((tx) => refreshAvailability(tx, actor.establishmentId, [row.id]));
    return row;
  }
  const row = await prisma.ingredient.create({ data: { establishmentId: actor.establishmentId, name: input.name, unit: input.unit ?? "pce", stockMin: input.stockMin ?? 0, avgCost: input.avgCost ?? 0, lastCost: input.avgCost ?? 0, isCritical: input.isCritical ?? false } });
  await audit({ ...actor, action: "ingredient.create", entityType: "ingredient", entityId: row.id, newValue: { name: row.name, unit: row.unit } });
  return row;
}

export async function archiveIngredient(actor: Actor, id: string) {
  const existing = await prisma.ingredient.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Ingrédient introuvable");
  await prisma.ingredient.update({ where: { id }, data: { isActive: false } });
  await audit({ ...actor, action: "ingredient.archive", entityType: "ingredient", entityId: id, oldValue: { name: existing.name } });
}

export async function listMovements(establishmentId: string, opts: { ingredientId?: string; kind?: InventoryMovementKind; from?: Date; to?: Date; take?: number } = {}) {
  const rows = await prisma.inventoryMovement.findMany({
    where: { establishmentId, ...(opts.ingredientId ? { ingredientId: opts.ingredientId } : {}), ...(opts.kind ? { kind: opts.kind } : {}), ...(opts.from || opts.to ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } } : {}) },
    orderBy: { createdAt: "desc" }, take: opts.take ?? 200,
    include: { ingredient: { select: { id: true, name: true, unit: true } }, user: { select: { firstName: true, displayName: true } } },
  });
  return rows.map((m) => ({ ...m, quantity: n(m.quantity), value: m.unitCost !== null ? Math.round(Math.abs(n(m.quantity)) * m.unitCost) : null }));
}

/** Applique un mouvement : crée la ligne, met à jour le stock (et le coût moyen pondéré pour un achat). */
async function applyMovement(tx: Tx, input: { establishmentId: string; ingredientId: string; userId?: string | null; kind: InventoryMovementKind; quantity: number; unitCost?: number | null; reason?: string | null; referenceId?: string | null }) {
  // Verrou de l'ingrédient : deux mouvements simultanés (deux envois en cuisine) ne perdent pas de décrémentation
  await tx.$queryRaw`SELECT id FROM ingredients WHERE id = ${input.ingredientId}::uuid FOR UPDATE`;
  const ing = await tx.ingredient.findFirst({ where: { id: input.ingredientId, establishmentId: input.establishmentId } });
  if (!ing) throw new ApiError(404, "NOT_FOUND", "Ingrédient introuvable");
  const qty = round3(input.quantity);
  if (qty === 0) return { ingredient: ing, movement: null };
  const before = n(ing.stockQty);
  const after = round3(before + qty);
  const data: Prisma.IngredientUpdateInput = { stockQty: after };
  let unitCost = input.unitCost ?? ing.avgCost;
  if (input.kind === "PURCHASE" && qty > 0 && input.unitCost !== null && input.unitCost !== undefined) {
    // Coût moyen pondéré sur le stock positif existant
    const base = Math.max(0, before);
    data.avgCost = base + qty > 0 ? Math.round((base * ing.avgCost + qty * input.unitCost) / (base + qty)) : input.unitCost;
    data.lastCost = input.unitCost;
    unitCost = input.unitCost;
  }
  const updated = await tx.ingredient.update({ where: { id: ing.id }, data });
  const movement = await tx.inventoryMovement.create({ data: { establishmentId: input.establishmentId, ingredientId: ing.id, userId: input.userId ?? null, kind: input.kind, quantity: qty, unitCost, reason: input.reason ?? null, referenceId: input.referenceId ?? null } });
  return { ingredient: updated, movement };
}

/** Mouvement manuel : ajustement, perte, casse, usage interne, achat direct. */
export async function addMovement(actor: Actor, input: { ingredientId: string; kind: Exclude<InventoryMovementKind, "SALE" | "INVENTORY">; quantity: number; unitCost?: number | null; reason?: string | null }) {
  const removal = input.kind === "LOSS" || input.kind === "BREAKAGE" || input.kind === "INTERNAL_USE";
  if (removal && input.quantity <= 0) throw new ApiError(400, "BAD_QUANTITY", "La quantité perdue doit être positive");
  if (input.kind === "PURCHASE" && input.quantity <= 0) throw new ApiError(400, "BAD_QUANTITY", "La quantité achetée doit être positive");
  if (removal && !input.reason) throw new ApiError(400, "REASON_REQUIRED", "Indiquez le motif de la perte");
  const signed = removal ? -Math.abs(input.quantity) : input.quantity;
  const res = await prisma.$transaction(async (tx) => {
    const r = await applyMovement(tx, { establishmentId: actor.establishmentId, ingredientId: input.ingredientId, userId: actor.userId, kind: input.kind, quantity: signed, unitCost: input.unitCost ?? undefined, reason: input.reason });
    await refreshAvailability(tx, actor.establishmentId, [input.ingredientId]);
    await audit({ ...actor, action: "stock.movement", entityType: "ingredient", entityId: input.ingredientId, newValue: { kind: input.kind, quantity: signed, unitCost: input.unitCost ?? null, stockAfter: n(r.ingredient.stockQty) }, reason: input.reason }, tx);
    return r;
  });
  publish("catalog.updated", actor.establishmentId, { stock: true });
  return { ...res.ingredient, stockQty: n(res.ingredient.stockQty), stockMin: n(res.ingredient.stockMin), movement: res.movement ? { ...res.movement, quantity: n(res.movement.quantity) } : null };
}

/** Inventaire : le comptage remplace le stock ; l'écart est tracé (mouvement INVENTORY). */
export async function applyInventory(actor: Actor, lines: { ingredientId: string; countedQty: number }[], reason?: string | null) {
  const result = await prisma.$transaction(async (tx) => {
    const out: { ingredientId: string; name: string; unit: string; before: number; counted: number; diff: number; value: number }[] = [];
    for (const line of lines) {
      const ing = await tx.ingredient.findFirst({ where: { id: line.ingredientId, establishmentId: actor.establishmentId } });
      if (!ing) throw new ApiError(404, "NOT_FOUND", "Ingrédient introuvable");
      const before = n(ing.stockQty);
      const diff = round3(line.countedQty - before);
      if (diff !== 0) await applyMovement(tx, { establishmentId: actor.establishmentId, ingredientId: ing.id, userId: actor.userId, kind: "INVENTORY", quantity: diff, reason: reason ?? "Inventaire" });
      out.push({ ingredientId: ing.id, name: ing.name, unit: ing.unit, before, counted: line.countedQty, diff, value: Math.round(diff * ing.avgCost) });
    }
    await refreshAvailability(tx, actor.establishmentId, lines.map((l) => l.ingredientId));
    await audit({ ...actor, action: "stock.inventory", entityType: "establishment", entityId: actor.establishmentId, newValue: { lines: out.length, adjusted: out.filter((o) => o.diff !== 0).length, value: out.reduce((a, o) => a + o.value, 0) }, reason }, tx);
    return out;
  });
  publish("catalog.updated", actor.establishmentId, { stock: true });
  return { lines: result, totalValue: result.reduce((a, o) => a + o.value, 0) };
}

// ------------------------------------------------------------------ Recettes
export async function getRecipe(establishmentId: string, productId: string) {
  const product = await prisma.product.findFirst({ where: { id: productId, establishmentId }, select: { id: true, name: true, priceTtc: true, costPrice: true, taxRate: { select: { rateBps: true } }, recipeLines: { include: { ingredient: { select: { id: true, name: true, unit: true, avgCost: true, stockQty: true, isCritical: true } } } } } });
  if (!product) throw new ApiError(404, "NOT_FOUND", "Produit introuvable");
  const lines = product.recipeLines.map((l) => ({ ingredientId: l.ingredientId, name: l.ingredient.name, unit: l.ingredient.unit, quantity: n(l.quantity), avgCost: l.ingredient.avgCost, cost: Math.round(n(l.quantity) * l.ingredient.avgCost), stockQty: n(l.ingredient.stockQty), isCritical: l.ingredient.isCritical }));
  const computedCost = lines.reduce((a, l) => a + l.cost, 0);
  const priceHt = product.taxRate ? Math.round(product.priceTtc / (1 + product.taxRate.rateBps / 10000)) : product.priceTtc;
  return { product: { id: product.id, name: product.name, priceTtc: product.priceTtc, priceHt, costPrice: product.costPrice }, lines, computedCost, marginPct: priceHt > 0 ? Math.round(((priceHt - computedCost) / priceHt) * 1000) / 10 : null };
}

export async function setRecipe(actor: Actor, productId: string, lines: { ingredientId: string; quantity: number }[], opts: { applyCost?: boolean } = {}) {
  const product = await prisma.product.findFirst({ where: { id: productId, establishmentId: actor.establishmentId } });
  if (!product) throw new ApiError(404, "NOT_FOUND", "Produit introuvable");
  const ids = [...new Set(lines.map((l) => l.ingredientId))];
  const ings = await prisma.ingredient.findMany({ where: { id: { in: ids }, establishmentId: actor.establishmentId } });
  if (ings.length !== ids.length) throw new ApiError(400, "BAD_INGREDIENT", "Ingrédient inconnu");
  await prisma.$transaction(async (tx) => {
    await tx.recipeLine.deleteMany({ where: { productId } });
    if (lines.length) await tx.recipeLine.createMany({ data: lines.filter((l) => l.quantity > 0).map((l) => ({ productId, ingredientId: l.ingredientId, quantity: l.quantity })) });
    if (opts.applyCost) {
      const cost = lines.reduce((a, l) => a + l.quantity * (ings.find((i) => i.id === l.ingredientId)?.avgCost ?? 0), 0);
      await tx.product.update({ where: { id: productId }, data: { costPrice: Math.round(cost) } });
    }
    await refreshAvailability(tx, actor.establishmentId, ids);
    await audit({ ...actor, action: "recipe.update", entityType: "product", entityId: productId, newValue: { lines: lines.length, applyCost: !!opts.applyCost } }, tx);
  });
  publish("catalog.updated", actor.establishmentId, { productId });
  return getRecipe(actor.establishmentId, productId);
}

// ------------------------------------------------------------------ Décrémentation automatique
/**
 * Consomme (direction -1) ou restitue (direction +1) les ingrédients des articles vendus,
 * selon leur recette, et le stock produit simple (trackStock). Appelé dans la transaction
 * d'envoi en cuisine, d'annulation d'article et d'annulation de commande.
 */
export async function consumeForItems(tx: Tx, establishmentId: string, items: { id: string; productId: string | null; quantity: number }[], direction: -1 | 1, referenceId: string, userId?: string | null) {
  const withProduct = items.filter((i) => i.productId);
  if (withProduct.length === 0) return;
  const productIds = [...new Set(withProduct.map((i) => i.productId!))];
  const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, trackStock: true, stockQty: true, recipeLines: { select: { ingredientId: true, quantity: true } } } });
  const touched = new Set<string>();
  for (const item of withProduct) {
    const p = products.find((x) => x.id === item.productId);
    if (!p) continue;
    if (p.trackStock) {
      await tx.product.update({ where: { id: p.id }, data: { stockQty: { increment: direction * item.quantity } } });
      touched.add(`product:${p.id}`);
    }
    for (const line of p.recipeLines) {
      await applyMovement(tx, { establishmentId, ingredientId: line.ingredientId, userId: userId ?? null, kind: direction < 0 ? "SALE" : "ADJUSTMENT", quantity: direction * n(line.quantity) * item.quantity, reason: direction < 0 ? null : "Annulation d'article", referenceId });
      touched.add(line.ingredientId);
    }
  }
  await refreshAvailability(tx, establishmentId, [...touched].filter((t) => !t.startsWith("product:")), productIds);
}

/**
 * Rupture automatique : un produit devient indisponible si son stock simple est épuisé ou si un
 * ingrédient critique de sa recette est à zéro ; il redevient disponible quand le stock revient.
 */
export async function refreshAvailability(tx: Tx, establishmentId: string, ingredientIds: string[] = [], productIds: string[] = []) {
  const where: Prisma.ProductWhereInput = { establishmentId, isActive: true, OR: [{ trackStock: true }, { recipeLines: { some: {} } }] };
  if (ingredientIds.length || productIds.length) where.AND = [{ OR: [...(productIds.length ? [{ id: { in: productIds } }] : []), ...(ingredientIds.length ? [{ recipeLines: { some: { ingredientId: { in: ingredientIds } } } }] : [])] }];
  const products = await tx.product.findMany({ where, select: { id: true, name: true, trackStock: true, stockQty: true, autoUnavailable: true, recipeLines: { select: { ingredient: { select: { stockQty: true, isCritical: true, isActive: true } } } } } });
  let changed = false;
  for (const p of products) {
    const out = (p.trackStock && p.stockQty <= 0) || p.recipeLines.some((l) => l.ingredient.isCritical && l.ingredient.isActive && n(l.ingredient.stockQty) <= 0);
    if (out !== p.autoUnavailable) { await tx.product.update({ where: { id: p.id }, data: { autoUnavailable: out } }); changed = true; }
  }
  if (changed) publish("product.availability", establishmentId, { auto: true });
}

// ------------------------------------------------------------------ Alertes
export async function stockAlerts(establishmentId: string) {
  const [ingredients, products] = await Promise.all([
    prisma.ingredient.findMany({ where: { establishmentId, isActive: true }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: { establishmentId, isActive: true, OR: [{ autoUnavailable: true }, { trackStock: true }] }, select: { id: true, name: true, trackStock: true, stockQty: true, stockMin: true, autoUnavailable: true } }),
  ]);
  const below = ingredients.filter((i) => n(i.stockQty) <= n(i.stockMin)).map((i) => ({ id: i.id, name: i.name, unit: i.unit, stockQty: n(i.stockQty), stockMin: n(i.stockMin), isCritical: i.isCritical, out: n(i.stockQty) <= 0 }));
  return {
    ingredients: below,
    productsUnavailable: products.filter((p) => p.autoUnavailable).map((p) => ({ id: p.id, name: p.name })),
    productsLow: products.filter((p) => p.trackStock && p.stockQty <= p.stockMin).map((p) => ({ id: p.id, name: p.name, stockQty: p.stockQty, stockMin: p.stockMin })),
    count: below.length + products.filter((p) => p.autoUnavailable).length,
  };
}

// ------------------------------------------------------------------ Fournisseurs
export async function listSuppliers(establishmentId: string, includeInactive = false) {
  return prisma.supplier.findMany({ where: { establishmentId, ...(includeInactive ? {} : { isActive: true }) }, orderBy: { name: "asc" }, include: { _count: { select: { products: true, purchaseOrders: true } } } });
}

export async function upsertSupplier(actor: Actor, input: { id?: string; name: string; contactName?: string | null; phone?: string | null; email?: string | null; address?: string | null; notes?: string | null; isActive?: boolean }) {
  if (input.id) {
    const existing = await prisma.supplier.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Fournisseur introuvable");
    return prisma.supplier.update({ where: { id: input.id }, data: { name: input.name, contactName: input.contactName, phone: input.phone, email: input.email, address: input.address, notes: input.notes, isActive: input.isActive } });
  }
  const row = await prisma.supplier.create({ data: { establishmentId: actor.establishmentId, name: input.name, contactName: input.contactName ?? null, phone: input.phone ?? null, email: input.email ?? null, address: input.address ?? null, notes: input.notes ?? null } });
  await audit({ ...actor, action: "supplier.create", entityType: "supplier", entityId: row.id, newValue: { name: row.name } });
  return row;
}

export async function archiveSupplier(actor: Actor, id: string) {
  const existing = await prisma.supplier.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Fournisseur introuvable");
  await prisma.supplier.update({ where: { id }, data: { isActive: false } });
  await audit({ ...actor, action: "supplier.archive", entityType: "supplier", entityId: id, oldValue: { name: existing.name } });
}

export async function listSupplierProducts(establishmentId: string, supplierId?: string) {
  const rows = await prisma.supplierProduct.findMany({ where: { supplier: { establishmentId }, ...(supplierId ? { supplierId } : {}) }, orderBy: { name: "asc" }, include: { ingredient: { select: { id: true, name: true, unit: true, stockQty: true, stockMin: true } }, product: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } } });
  return rows.map((r) => ({ ...r, packSize: n(r.packSize), ingredient: r.ingredient ? { ...r.ingredient, stockQty: n(r.ingredient.stockQty), stockMin: n(r.ingredient.stockMin) } : null }));
}

export async function upsertSupplierProduct(actor: Actor, input: { id?: string; supplierId: string; ingredientId?: string | null; productId?: string | null; reference?: string | null; name: string; packSize?: number; lastPrice?: number }) {
  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, establishmentId: actor.establishmentId } });
  if (!supplier) throw new ApiError(404, "NOT_FOUND", "Fournisseur introuvable");
  if (input.ingredientId && !(await prisma.ingredient.findFirst({ where: { id: input.ingredientId, establishmentId: actor.establishmentId } }))) throw new ApiError(400, "BAD_INGREDIENT", "Ingrédient inconnu");
  if (input.productId && !(await prisma.product.findFirst({ where: { id: input.productId, establishmentId: actor.establishmentId } }))) throw new ApiError(400, "BAD_PRODUCT", "Produit inconnu");
  const data = { supplierId: input.supplierId, ingredientId: input.ingredientId ?? null, productId: input.productId ?? null, reference: input.reference ?? null, name: input.name, packSize: input.packSize ?? 1, lastPrice: input.lastPrice ?? 0 };
  if (input.id) {
    const existing = await prisma.supplierProduct.findFirst({ where: { id: input.id, supplier: { establishmentId: actor.establishmentId } } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Article fournisseur introuvable");
    return prisma.supplierProduct.update({ where: { id: input.id }, data: { ...data, avgPrice: existing.avgPrice || data.lastPrice } });
  }
  return prisma.supplierProduct.create({ data: { ...data, avgPrice: data.lastPrice } });
}

export async function deleteSupplierProduct(actor: Actor, id: string) {
  const existing = await prisma.supplierProduct.findFirst({ where: { id, supplier: { establishmentId: actor.establishmentId } }, include: { _count: { select: { lines: true } } } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Article fournisseur introuvable");
  if (existing._count.lines > 0) throw new ApiError(409, "IN_USE", "Cet article figure sur des bons de commande");
  await prisma.supplierProduct.delete({ where: { id } });
}

// ------------------------------------------------------------------ Bons de commande
const poInclude = { supplier: { select: { id: true, name: true, email: true, phone: true } }, lines: { include: { supplierProduct: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } } } } satisfies Prisma.PurchaseOrderInclude;

function mapPo(po: Prisma.PurchaseOrderGetPayload<{ include: typeof poInclude }>) {
  return { ...po, lines: po.lines.map((l) => ({ ...l, quantity: n(l.quantity), receivedQty: n(l.receivedQty), lineTotal: Math.round(n(l.quantity) * l.unitPrice), supplierProduct: { ...l.supplierProduct, packSize: n(l.supplierProduct.packSize) } })) };
}

export async function listPurchaseOrders(establishmentId: string, opts: { status?: PurchaseOrderStatus; take?: number } = {}) {
  const rows = await prisma.purchaseOrder.findMany({ where: { establishmentId, ...(opts.status ? { status: opts.status } : {}) }, orderBy: { createdAt: "desc" }, take: opts.take ?? 100, include: poInclude });
  return rows.map(mapPo);
}

export async function getPurchaseOrder(establishmentId: string, id: string) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, establishmentId }, include: poInclude });
  if (!po) throw new ApiError(404, "NOT_FOUND", "Bon de commande introuvable");
  return mapPo(po);
}

async function nextPoNumber(tx: Tx, establishmentId: string, timezone: string) {
  const day = localDay(new Date(), timezone).replace(/-/g, "");
  const count = await tx.purchaseOrder.count({ where: { establishmentId, number: { startsWith: `BC-${day}-` } } });
  return `BC-${day}-${String(count + 1).padStart(3, "0")}`;
}

type PoLineInput = { supplierProductId: string; quantity: number; unitPrice?: number | null };

async function validateLines(establishmentId: string, supplierId: string, lines: PoLineInput[]) {
  const ids = [...new Set(lines.map((l) => l.supplierProductId))];
  const sps = await prisma.supplierProduct.findMany({ where: { id: { in: ids }, supplierId, supplier: { establishmentId } } });
  if (sps.length !== ids.length) throw new ApiError(400, "BAD_LINE", "Article fournisseur inconnu pour ce fournisseur");
  return lines.filter((l) => l.quantity > 0).map((l) => { const sp = sps.find((s) => s.id === l.supplierProductId)!; return { supplierProductId: sp.id, quantity: l.quantity, unitPrice: l.unitPrice ?? sp.lastPrice }; });
}

export async function createPurchaseOrder(actor: Actor, input: { supplierId: string; expectedAt?: string | null; notes?: string | null; lines: PoLineInput[] }) {
  const supplier = await prisma.supplier.findFirst({ where: { id: input.supplierId, establishmentId: actor.establishmentId } });
  if (!supplier) throw new ApiError(404, "NOT_FOUND", "Fournisseur introuvable");
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { timezone: true } });
  const lines = await validateLines(actor.establishmentId, input.supplierId, input.lines);
  if (lines.length === 0) throw new ApiError(400, "NO_LINES", "Ajoutez au moins une ligne");
  const po = await prisma.$transaction(async (tx) => {
    const number = await nextPoNumber(tx, actor.establishmentId, est.timezone);
    const created = await tx.purchaseOrder.create({ data: { establishmentId: actor.establishmentId, supplierId: input.supplierId, number, expectedAt: input.expectedAt ? new Date(input.expectedAt) : null, notes: input.notes ?? null, total: lines.reduce((a, l) => a + Math.round(l.quantity * l.unitPrice), 0), lines: { create: lines } } });
    await audit({ ...actor, action: "purchase_order.create", entityType: "purchase_order", entityId: created.id, newValue: { number, supplier: supplier.name, total: created.total } }, tx);
    return created;
  });
  return getPurchaseOrder(actor.establishmentId, po.id);
}

export async function updatePurchaseOrder(actor: Actor, id: string, input: { expectedAt?: string | null; notes?: string | null; lines?: PoLineInput[] }) {
  const po = await getPurchaseOrder(actor.establishmentId, id);
  if (po.status !== "DRAFT") throw new ApiError(409, "PO_LOCKED", "Seul un brouillon peut être modifié");
  const lines = input.lines ? await validateLines(actor.establishmentId, po.supplierId, input.lines) : null;
  await prisma.$transaction(async (tx) => {
    if (lines) { await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } }); await tx.purchaseOrderLine.createMany({ data: lines.map((l) => ({ ...l, purchaseOrderId: id })) }); }
    await tx.purchaseOrder.update({ where: { id }, data: { expectedAt: input.expectedAt === undefined ? undefined : input.expectedAt ? new Date(input.expectedAt) : null, notes: input.notes, ...(lines ? { total: lines.reduce((a, l) => a + Math.round(l.quantity * l.unitPrice), 0) } : {}) } });
  });
  return getPurchaseOrder(actor.establishmentId, id);
}

export async function sendPurchaseOrder(actor: Actor, id: string) {
  const po = await getPurchaseOrder(actor.establishmentId, id);
  if (po.status !== "DRAFT") throw new ApiError(409, "PO_LOCKED", "Ce bon n'est plus un brouillon");
  await prisma.purchaseOrder.update({ where: { id }, data: { status: "SENT" } });
  await audit({ ...actor, action: "purchase_order.send", entityType: "purchase_order", entityId: id, newValue: { number: po.number } });
  return getPurchaseOrder(actor.establishmentId, id);
}

/** Réception (totale ou partielle) : entrées en stock au prix du bon, mise à jour des prix fournisseur. */
export async function receivePurchaseOrder(actor: Actor, id: string, received: { lineId: string; receivedQty: number }[]) {
  const po = await getPurchaseOrder(actor.establishmentId, id);
  if (po.status === "CANCELLED" || po.status === "RECEIVED") throw new ApiError(409, "PO_CLOSED", "Ce bon est clôturé");
  if (new Set(received.map((r) => r.lineId)).size !== received.length) throw new ApiError(400, "BAD_LINE", "Ligne en double dans la réception");
  await prisma.$transaction(async (tx) => {
    // Bon verrouillé et quantités déjà reçues relues dans la transaction : une double validation n'ajoute pas deux fois le stock
    await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
    const fresh = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, select: { status: true, lines: { select: { id: true, receivedQty: true } } } });
    if (fresh.status === "CANCELLED" || fresh.status === "RECEIVED") throw new ApiError(409, "PO_CLOSED", "Ce bon est clôturé");
    for (const r of received) {
      const line = po.lines.find((l) => l.id === r.lineId);
      if (!line) throw new ApiError(400, "BAD_LINE", "Ligne inconnue");
      const already = n(fresh.lines.find((l) => l.id === r.lineId)?.receivedQty ?? line.receivedQty);
      const delta = round3(r.receivedQty - already);
      if (delta <= 0) continue;
      await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { receivedQty: r.receivedQty } });
      const sp = line.supplierProduct;
      const unitCost = sp.packSize > 0 ? Math.round(line.unitPrice / sp.packSize) : line.unitPrice;
      if (sp.ingredientId) await applyMovement(tx, { establishmentId: actor.establishmentId, ingredientId: sp.ingredientId, userId: actor.userId, kind: "PURCHASE", quantity: delta * sp.packSize, unitCost, reason: `Réception ${po.number}`, referenceId: po.id });
      if (sp.productId) await tx.product.update({ where: { id: sp.productId }, data: { stockQty: { increment: Math.round(delta * sp.packSize) } } });
      await tx.supplierProduct.update({ where: { id: sp.id }, data: { lastPrice: line.unitPrice, avgPrice: sp.avgPrice ? Math.round((sp.avgPrice + line.unitPrice) / 2) : line.unitPrice } });
    }
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } });
    const complete = lines.every((l) => n(l.receivedQty) >= n(l.quantity));
    const any = lines.some((l) => n(l.receivedQty) > 0);
    await tx.purchaseOrder.update({ where: { id }, data: { status: complete ? "RECEIVED" : any ? "PARTIALLY_RECEIVED" : po.status === "DRAFT" ? "SENT" : po.status, receivedAt: complete ? new Date() : null } });
    await refreshAvailability(tx, actor.establishmentId, po.lines.map((l) => l.supplierProduct.ingredientId).filter((x): x is string => !!x), po.lines.map((l) => l.supplierProduct.productId).filter((x): x is string => !!x));
    await audit({ ...actor, action: "purchase_order.receive", entityType: "purchase_order", entityId: id, newValue: { number: po.number, complete, lines: received } }, tx);
  });
  publish("catalog.updated", actor.establishmentId, { stock: true });
  return getPurchaseOrder(actor.establishmentId, id);
}

export async function cancelPurchaseOrder(actor: Actor, id: string) {
  const po = await getPurchaseOrder(actor.establishmentId, id);
  if (po.status === "RECEIVED" || po.status === "PARTIALLY_RECEIVED") throw new ApiError(409, "PO_RECEIVED", "Un bon reçu ne peut pas être annulé");
  await prisma.purchaseOrder.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit({ ...actor, action: "purchase_order.cancel", entityType: "purchase_order", entityId: id, newValue: { number: po.number } });
  return getPurchaseOrder(actor.establishmentId, id);
}

/** Suggestion de commande : ingrédients sous le seuil ayant un article fournisseur, regroupés par fournisseur. */
export async function suggestPurchase(establishmentId: string) {
  const sps = await listSupplierProducts(establishmentId);
  const bySupplier = new Map<string, { supplier: { id: string; name: string }; lines: { supplierProductId: string; name: string; ingredient: string; unit: string; stockQty: number; stockMin: number; packSize: number; suggestedPacks: number; unitPrice: number }[] }>();
  for (const sp of sps) {
    if (!sp.ingredient || sp.ingredient.stockQty > sp.ingredient.stockMin) continue;
    const target = Math.max(sp.ingredient.stockMin * 2, sp.ingredient.stockMin + sp.packSize);
    const packs = Math.max(1, Math.ceil((target - sp.ingredient.stockQty) / (sp.packSize || 1)));
    const g = bySupplier.get(sp.supplierId) ?? { supplier: sp.supplier, lines: [] };
    if (!g.lines.some((l) => l.ingredient === sp.ingredient!.name)) g.lines.push({ supplierProductId: sp.id, name: sp.name, ingredient: sp.ingredient.name, unit: sp.ingredient.unit, stockQty: sp.ingredient.stockQty, stockMin: sp.ingredient.stockMin, packSize: sp.packSize, suggestedPacks: packs, unitPrice: sp.lastPrice });
    bySupplier.set(sp.supplierId, g);
  }
  return [...bySupplier.values()].map((g) => ({ ...g, total: g.lines.reduce((a, l) => a + l.suggestedPacks * l.unitPrice, 0) }));
}

// ------------------------------------------------------------------ Rapport : consommation, achats, pertes, food cost
export async function stockReport(establishmentId: string, from: Date, to: Date) {
  const [movements, ingredients, revenueAgg] = await Promise.all([
    prisma.inventoryMovement.findMany({ where: { establishmentId, createdAt: { gte: from, lt: to } }, include: { ingredient: { select: { id: true, name: true, unit: true } } } }),
    prisma.ingredient.findMany({ where: { establishmentId, isActive: true } }),
    prisma.order.aggregate({ where: { establishmentId, status: "PAID", closedAt: { gte: from, lt: to } }, _sum: { total: true, taxTotal: true } }),
  ]);
  const value = (m: (typeof movements)[number]) => Math.round(Math.abs(n(m.quantity)) * (m.unitCost ?? 0));
  const sum = (kinds: InventoryMovementKind[]) => movements.filter((m) => kinds.includes(m.kind)).reduce((a, m) => a + value(m), 0);
  const consumption = sum(["SALE"]);
  const restored = movements.filter((m) => m.kind === "ADJUSTMENT" && m.reason === "Annulation d'article").reduce((a, m) => a + value(m), 0);
  const losses = sum(["LOSS", "BREAKAGE", "INTERNAL_USE"]);
  const purchases = sum(["PURCHASE"]);
  const inventoryDiff = movements.filter((m) => m.kind === "INVENTORY").reduce((a, m) => a + Math.round(n(m.quantity) * (m.unitCost ?? 0)), 0);
  const revenue = revenueAgg._sum.total ?? 0;
  const revenueHt = revenue - (revenueAgg._sum.taxTotal ?? 0);
  const netConsumption = consumption - restored;
  const byIngredient = new Map<string, { name: string; unit: string; qty: number; value: number }>();
  for (const m of movements.filter((x) => x.kind === "SALE")) {
    const e = byIngredient.get(m.ingredientId) ?? { name: m.ingredient.name, unit: m.ingredient.unit, qty: 0, value: 0 };
    e.qty = round3(e.qty + Math.abs(n(m.quantity))); e.value += value(m); byIngredient.set(m.ingredientId, e);
  }
  const lossByIngredient = new Map<string, { name: string; unit: string; qty: number; value: number }>();
  for (const m of movements.filter((x) => x.kind === "LOSS" || x.kind === "BREAKAGE" || x.kind === "INTERNAL_USE")) {
    const e = lossByIngredient.get(m.ingredientId) ?? { name: m.ingredient.name, unit: m.ingredient.unit, qty: 0, value: 0 };
    e.qty = round3(e.qty + Math.abs(n(m.quantity))); e.value += value(m); lossByIngredient.set(m.ingredientId, e);
  }
  return {
    from: from.toISOString(), to: to.toISOString(),
    revenue, revenueHt, consumption: netConsumption, purchases, losses, inventoryDiff,
    foodCostPct: revenueHt > 0 ? Math.round((netConsumption / revenueHt) * 1000) / 10 : null,
    lossPct: revenueHt > 0 ? Math.round((losses / revenueHt) * 1000) / 10 : null,
    stockValue: ingredients.reduce((a, i) => a + Math.round(n(i.stockQty) * i.avgCost), 0),
    topConsumed: [...byIngredient.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.value - a.value).slice(0, 15),
    topLosses: [...lossByIngredient.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.value - a.value).slice(0, 10),
    movementsCount: movements.length,
  };
}
