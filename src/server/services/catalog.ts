import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { Prisma } from "@/generated/prisma/client";

type Actor = { organizationId: string; establishmentId: string; userId: string };

// ---------------------------------------------------------------- TVA
export async function listTaxRates(establishmentId: string) {
  return prisma.taxRate.findMany({ where: { establishmentId }, orderBy: [{ isDefault: "desc" }, { rateBps: "desc" }] });
}

export async function upsertTaxRate(actor: Actor, input: { id?: string; name: string; rateBps: number; isDefault?: boolean; isActive?: boolean }) {
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.taxRate.updateMany({ where: { establishmentId: actor.establishmentId }, data: { isDefault: false } });
    const before = input.id ? await tx.taxRate.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } }) : null;
    if (input.id && !before) throw new ApiError(404, "NOT_FOUND", "Taux de TVA introuvable");
    const rate = input.id
      ? await tx.taxRate.update({ where: { id: input.id }, data: { name: input.name, rateBps: input.rateBps, isDefault: input.isDefault ?? before!.isDefault, isActive: input.isActive ?? true } })
      : await tx.taxRate.create({ data: { establishmentId: actor.establishmentId, name: input.name, rateBps: input.rateBps, isDefault: input.isDefault ?? false } });
    await audit({ ...actor, action: input.id ? "taxrate.update" : "taxrate.create", entityType: "tax_rate", entityId: rate.id, oldValue: before, newValue: rate }, tx);
    return rate;
  });
}

export async function deleteTaxRate(actor: Actor, id: string) {
  const rate = await prisma.taxRate.findFirst({ where: { id, establishmentId: actor.establishmentId }, include: { _count: { select: { products: true, menus: true } } } });
  if (!rate) throw new ApiError(404, "NOT_FOUND", "Taux de TVA introuvable");
  if (rate._count.products + rate._count.menus > 0) throw new ApiError(409, "IN_USE", "Ce taux est utilisé par des produits");
  await prisma.taxRate.delete({ where: { id } });
  await audit({ ...actor, action: "taxrate.delete", entityType: "tax_rate", entityId: id, oldValue: rate });
}

// ---------------------------------------------------------------- Catégories
export async function listCategories(establishmentId: string) {
  return prisma.category.findMany({ where: { establishmentId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true } } } });
}

export async function upsertCategory(actor: Actor, input: { id?: string; name: string; color?: string; parentId?: string | null; sortOrder?: number; isActive?: boolean; imageUrl?: string | null }) {
  const data = { name: input.name, color: input.color, parentId: input.parentId, sortOrder: input.sortOrder, isActive: input.isActive, imageUrl: input.imageUrl };
  if (input.id) {
    const existing = await prisma.category.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Catégorie introuvable");
    const cat = await prisma.category.update({ where: { id: input.id }, data });
    publish("catalog.updated", actor.establishmentId, { entity: "category", id: cat.id });
    return cat;
  }
  const max = await prisma.category.aggregate({ where: { establishmentId: actor.establishmentId }, _max: { sortOrder: true } });
  const cat = await prisma.category.create({ data: { establishmentId: actor.establishmentId, ...data, name: input.name, color: input.color ?? "#0EA5A4", sortOrder: input.sortOrder ?? (max._max.sortOrder ?? 0) + 1 } });
  publish("catalog.updated", actor.establishmentId, { entity: "category", id: cat.id });
  return cat;
}

export async function reorderCategories(actor: Actor, ids: string[]) {
  await prisma.$transaction(ids.map((id, i) => prisma.category.updateMany({ where: { id, establishmentId: actor.establishmentId }, data: { sortOrder: i } })));
  publish("catalog.updated", actor.establishmentId, { entity: "category" });
}

export async function deleteCategory(actor: Actor, id: string) {
  const cat = await prisma.category.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!cat) throw new ApiError(404, "NOT_FOUND", "Catégorie introuvable");
  await prisma.category.delete({ where: { id } });
  await audit({ ...actor, action: "category.delete", entityType: "category", entityId: id, oldValue: cat });
  publish("catalog.updated", actor.establishmentId, { entity: "category", id });
}

// ---------------------------------------------------------------- Produits
export const productInclude = {
  category: { select: { id: true, name: true, color: true } },
  taxRate: true,
  kitchenStation: { select: { id: true, name: true } },
  variants: { where: { isActive: true }, orderBy: { sortOrder: "asc" as const } },
  modifierGroups: {
    orderBy: { sortOrder: "asc" as const },
    include: { modifierGroup: { include: { modifiers: { orderBy: { sortOrder: "asc" as const } } } } },
  },
} satisfies Prisma.ProductInclude;

export async function listProducts(establishmentId: string, opts: { categoryId?: string; search?: string; includeInactive?: boolean } = {}) {
  return prisma.product.findMany({
    where: {
      establishmentId,
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(opts.categoryId ? { categoryId: opts.categoryId } : {}),
      ...(opts.search ? { OR: [{ name: { contains: opts.search, mode: "insensitive" } }, { sku: { contains: opts.search, mode: "insensitive" } }, { barcode: opts.search }] } : {}),
    },
    include: productInclude,
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

export async function getProduct(establishmentId: string, id: string) {
  const p = await prisma.product.findFirst({ where: { id, establishmentId }, include: productInclude });
  if (!p) throw new ApiError(404, "NOT_FOUND", "Produit introuvable");
  return p;
}

export type ProductInput = {
  name: string; description?: string | null; categoryId?: string | null; taxRateId?: string | null; kitchenStationId?: string | null;
  imageUrl?: string | null; color?: string | null; priceTtc: number; costPrice?: number; sku?: string | null; barcode?: string | null;
  isAvailable?: boolean; availability?: unknown; trackStock?: boolean; stockQty?: number; stockMin?: number; sortOrder?: number; isActive?: boolean;
  variants?: { id?: string; name: string; priceTtc: number; sku?: string | null }[];
  modifierGroupIds?: string[];
};

async function assertRefs(establishmentId: string, input: Partial<ProductInput>) {
  if (input.categoryId && !(await prisma.category.findFirst({ where: { id: input.categoryId, establishmentId } }))) throw new ApiError(400, "BAD_CATEGORY", "Catégorie invalide");
  if (input.taxRateId && !(await prisma.taxRate.findFirst({ where: { id: input.taxRateId, establishmentId } }))) throw new ApiError(400, "BAD_TAX", "Taux de TVA invalide");
  if (input.kitchenStationId && !(await prisma.kitchenStation.findFirst({ where: { id: input.kitchenStationId, establishmentId } }))) throw new ApiError(400, "BAD_STATION", "Poste cuisine invalide");
  if (input.modifierGroupIds?.length) {
    const count = await prisma.modifierGroup.count({ where: { id: { in: input.modifierGroupIds }, establishmentId } });
    if (count !== input.modifierGroupIds.length) throw new ApiError(400, "BAD_MODIFIER_GROUP", "Groupe d'options invalide");
  }
}

export async function createProduct(actor: Actor, input: ProductInput) {
  await assertRefs(actor.establishmentId, input);
  const taxRateId = input.taxRateId ?? (await prisma.taxRate.findFirst({ where: { establishmentId: actor.establishmentId, isDefault: true } }))?.id ?? null;
  const product = await prisma.product.create({
    data: {
      establishmentId: actor.establishmentId, name: input.name, description: input.description ?? null, categoryId: input.categoryId ?? null, taxRateId,
      kitchenStationId: input.kitchenStationId ?? null, imageUrl: input.imageUrl ?? null, color: input.color ?? null, priceTtc: input.priceTtc,
      costPrice: input.costPrice ?? 0, sku: input.sku || null, barcode: input.barcode || null, isAvailable: input.isAvailable ?? true,
      availability: (input.availability as Prisma.InputJsonValue) ?? undefined, trackStock: input.trackStock ?? false, stockQty: input.stockQty ?? 0, stockMin: input.stockMin ?? 0,
      sortOrder: input.sortOrder ?? 0, isActive: input.isActive ?? true,
      variants: input.variants ? { create: input.variants.map((v, i) => ({ name: v.name, priceTtc: v.priceTtc, sku: v.sku ?? null, sortOrder: i })) } : undefined,
      modifierGroups: input.modifierGroupIds ? { create: input.modifierGroupIds.map((modifierGroupId, i) => ({ modifierGroupId, sortOrder: i })) } : undefined,
    },
    include: productInclude,
  });
  await audit({ ...actor, action: "product.create", entityType: "product", entityId: product.id, newValue: { name: product.name, priceTtc: product.priceTtc } });
  publish("catalog.updated", actor.establishmentId, { entity: "product", id: product.id });
  return product;
}

export async function updateProduct(actor: Actor, id: string, input: Partial<ProductInput>) {
  const before = await getProduct(actor.establishmentId, id);
  await assertRefs(actor.establishmentId, input);
  const product = await prisma.$transaction(async (tx) => {
    if (input.variants) {
      const keep = input.variants.filter((v) => v.id).map((v) => v.id!);
      await tx.productVariant.deleteMany({ where: { productId: id, id: { notIn: keep } } });
      for (const [i, v] of input.variants.entries()) {
        if (v.id) await tx.productVariant.update({ where: { id: v.id }, data: { name: v.name, priceTtc: v.priceTtc, sku: v.sku ?? null, sortOrder: i } });
        else await tx.productVariant.create({ data: { productId: id, name: v.name, priceTtc: v.priceTtc, sku: v.sku ?? null, sortOrder: i } });
      }
    }
    if (input.modifierGroupIds) {
      await tx.productModifierGroup.deleteMany({ where: { productId: id } });
      await tx.productModifierGroup.createMany({ data: input.modifierGroupIds.map((modifierGroupId, i) => ({ productId: id, modifierGroupId, sortOrder: i })) });
    }
    return tx.product.update({
      where: { id },
      data: {
        name: input.name, description: input.description, categoryId: input.categoryId, taxRateId: input.taxRateId, kitchenStationId: input.kitchenStationId,
        imageUrl: input.imageUrl, color: input.color, priceTtc: input.priceTtc, costPrice: input.costPrice, sku: input.sku === "" ? null : input.sku,
        barcode: input.barcode === "" ? null : input.barcode, isAvailable: input.isAvailable, availability: input.availability === null ? Prisma.DbNull : (input.availability as Prisma.InputJsonValue | undefined),
        trackStock: input.trackStock, stockQty: input.stockQty, stockMin: input.stockMin, sortOrder: input.sortOrder, isActive: input.isActive,
      },
      include: productInclude,
    });
  });
  const changedPrice = input.priceTtc !== undefined && input.priceTtc !== before.priceTtc;
  await audit({
    ...actor, action: changedPrice ? "product.price_update" : "product.update", entityType: "product", entityId: id,
    oldValue: { name: before.name, priceTtc: before.priceTtc, isAvailable: before.isAvailable, isActive: before.isActive },
    newValue: { name: product.name, priceTtc: product.priceTtc, isAvailable: product.isAvailable, isActive: product.isActive },
  });
  publish("catalog.updated", actor.establishmentId, { entity: "product", id });
  if (input.isAvailable !== undefined && input.isAvailable !== before.isAvailable) publish("product.availability", actor.establishmentId, { productId: id, isAvailable: product.isAvailable });
  return product;
}

/** Rupture manuelle / retour en disponibilité, synchronisée en temps réel. */
export async function setProductAvailability(actor: Actor, id: string, isAvailable: boolean) {
  const before = await prisma.product.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!before) throw new ApiError(404, "NOT_FOUND", "Produit introuvable");
  const product = await prisma.product.update({ where: { id }, data: { isAvailable } });
  await audit({ ...actor, action: "product.availability", entityType: "product", entityId: id, oldValue: { isAvailable: before.isAvailable }, newValue: { isAvailable } });
  publish("product.availability", actor.establishmentId, { productId: id, isAvailable });
  return product;
}

export async function deleteProduct(actor: Actor, id: string) {
  const before = await prisma.product.findFirst({ where: { id, establishmentId: actor.establishmentId }, include: { _count: { select: { orderItems: true } } } });
  if (!before) throw new ApiError(404, "NOT_FOUND", "Produit introuvable");
  if (before._count.orderItems > 0) {
    // Conserver l'historique : archivage plutôt que suppression
    await prisma.product.update({ where: { id }, data: { isActive: false } });
  } else {
    await prisma.product.delete({ where: { id } });
  }
  await audit({ ...actor, action: "product.delete", entityType: "product", entityId: id, oldValue: { name: before.name, priceTtc: before.priceTtc } });
  publish("catalog.updated", actor.establishmentId, { entity: "product", id });
}

// ---------------------------------------------------------------- Groupes d'options
export async function listModifierGroups(establishmentId: string) {
  return prisma.modifierGroup.findMany({ where: { establishmentId }, include: { modifiers: { orderBy: { sortOrder: "asc" } }, _count: { select: { products: true } } }, orderBy: { sortOrder: "asc" } });
}

export type ModifierGroupInput = {
  name: string; minSelect: number; maxSelect: number | null; sortOrder?: number; isActive?: boolean;
  modifiers: { id?: string; name: string; priceDelta: number; isDefault?: boolean; isAvailable?: boolean }[];
};

export async function upsertModifierGroup(actor: Actor, input: ModifierGroupInput & { id?: string }) {
  if (input.maxSelect !== null && input.maxSelect < input.minSelect) throw new ApiError(400, "BAD_RANGE", "Le maximum doit être ≥ au minimum");
  const group = await prisma.$transaction(async (tx) => {
    let groupId = input.id;
    if (groupId) {
      const existing = await tx.modifierGroup.findFirst({ where: { id: groupId, establishmentId: actor.establishmentId } });
      if (!existing) throw new ApiError(404, "NOT_FOUND", "Groupe d'options introuvable");
      await tx.modifierGroup.update({ where: { id: groupId }, data: { name: input.name, minSelect: input.minSelect, maxSelect: input.maxSelect, sortOrder: input.sortOrder, isActive: input.isActive } });
      const keep = input.modifiers.filter((m) => m.id).map((m) => m.id!);
      await tx.modifier.deleteMany({ where: { groupId, id: { notIn: keep } } });
    } else {
      const g = await tx.modifierGroup.create({ data: { establishmentId: actor.establishmentId, name: input.name, minSelect: input.minSelect, maxSelect: input.maxSelect, sortOrder: input.sortOrder ?? 0 } });
      groupId = g.id;
    }
    for (const [i, m] of input.modifiers.entries()) {
      const data = { name: m.name, priceDelta: m.priceDelta, isDefault: m.isDefault ?? false, isAvailable: m.isAvailable ?? true, sortOrder: i };
      if (m.id) await tx.modifier.update({ where: { id: m.id }, data });
      else await tx.modifier.create({ data: { groupId, ...data } });
    }
    return tx.modifierGroup.findUniqueOrThrow({ where: { id: groupId }, include: { modifiers: { orderBy: { sortOrder: "asc" } } } });
  });
  publish("catalog.updated", actor.establishmentId, { entity: "modifierGroup", id: group.id });
  return group;
}

export async function deleteModifierGroup(actor: Actor, id: string) {
  const g = await prisma.modifierGroup.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!g) throw new ApiError(404, "NOT_FOUND", "Groupe d'options introuvable");
  await prisma.modifierGroup.delete({ where: { id } });
  publish("catalog.updated", actor.establishmentId, { entity: "modifierGroup", id });
}

// ---------------------------------------------------------------- Formules
export const menuInclude = {
  taxRate: true,
  sections: { orderBy: { sortOrder: "asc" as const }, include: { items: { orderBy: { sortOrder: "asc" as const }, include: { product: { select: { id: true, name: true, priceTtc: true, isAvailable: true, isActive: true, kitchenStationId: true, taxRateId: true, costPrice: true } } } } } },
} satisfies Prisma.MenuInclude;

export async function listMenus(establishmentId: string, includeInactive = false) {
  return prisma.menu.findMany({ where: { establishmentId, ...(includeInactive ? {} : { isActive: true }) }, include: menuInclude, orderBy: { sortOrder: "asc" } });
}

export type MenuInput = {
  name: string; description?: string | null; priceTtc: number; taxRateId?: string | null; color?: string | null; isActive?: boolean; sortOrder?: number;
  sections: { id?: string; name: string; minSelect: number; maxSelect: number; items: { productId: string; supplement: number }[] }[];
};

export async function upsertMenu(actor: Actor, input: MenuInput & { id?: string }) {
  const productIds = input.sections.flatMap((s) => s.items.map((i) => i.productId));
  if (productIds.length) {
    const count = await prisma.product.count({ where: { id: { in: productIds }, establishmentId: actor.establishmentId } });
    if (count !== new Set(productIds).size) throw new ApiError(400, "BAD_PRODUCT", "Produit invalide dans la formule");
  }
  const menu = await prisma.$transaction(async (tx) => {
    let menuId = input.id;
    const base = { name: input.name, description: input.description ?? null, priceTtc: input.priceTtc, taxRateId: input.taxRateId ?? null, color: input.color ?? null, isActive: input.isActive ?? true, sortOrder: input.sortOrder ?? 0 };
    if (menuId) {
      const existing = await tx.menu.findFirst({ where: { id: menuId, establishmentId: actor.establishmentId } });
      if (!existing) throw new ApiError(404, "NOT_FOUND", "Formule introuvable");
      await tx.menu.update({ where: { id: menuId }, data: base });
      await tx.menuSection.deleteMany({ where: { menuId } });
    } else {
      menuId = (await tx.menu.create({ data: { establishmentId: actor.establishmentId, ...base } })).id;
    }
    for (const [i, s] of input.sections.entries()) {
      await tx.menuSection.create({
        data: { menuId, name: s.name, minSelect: s.minSelect, maxSelect: s.maxSelect, sortOrder: i, items: { create: s.items.map((it, j) => ({ productId: it.productId, supplement: it.supplement, sortOrder: j })) } },
      });
    }
    return tx.menu.findUniqueOrThrow({ where: { id: menuId }, include: menuInclude });
  });
  await audit({ ...actor, action: input.id ? "menu.update" : "menu.create", entityType: "menu", entityId: menu.id, newValue: { name: menu.name, priceTtc: menu.priceTtc } });
  publish("catalog.updated", actor.establishmentId, { entity: "menu", id: menu.id });
  return menu;
}

export async function deleteMenu(actor: Actor, id: string) {
  const m = await prisma.menu.findFirst({ where: { id, establishmentId: actor.establishmentId }, include: { _count: { select: { orderItems: true } } } });
  if (!m) throw new ApiError(404, "NOT_FOUND", "Formule introuvable");
  if (m._count.orderItems > 0) await prisma.menu.update({ where: { id }, data: { isActive: false } });
  else await prisma.menu.delete({ where: { id } });
  publish("catalog.updated", actor.establishmentId, { entity: "menu", id });
}

// ---------------------------------------------------------------- Postes cuisine
export async function listKitchenStations(establishmentId: string) {
  return prisma.kitchenStation.findMany({ where: { establishmentId }, orderBy: { sortOrder: "asc" } });
}

export async function upsertKitchenStation(actor: Actor, input: { id?: string; name: string; color?: string; warnAfterSec?: number; alertAfterSec?: number; isActive?: boolean; sortOrder?: number }) {
  if (input.id) {
    const existing = await prisma.kitchenStation.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Poste introuvable");
    return prisma.kitchenStation.update({ where: { id: input.id }, data: { name: input.name, color: input.color, warnAfterSec: input.warnAfterSec, alertAfterSec: input.alertAfterSec, isActive: input.isActive, sortOrder: input.sortOrder } });
  }
  return prisma.kitchenStation.create({ data: { establishmentId: actor.establishmentId, name: input.name, color: input.color ?? "#F97316", warnAfterSec: input.warnAfterSec ?? 600, alertAfterSec: input.alertAfterSec ?? 900, sortOrder: input.sortOrder ?? 0 } });
}

// ---------------------------------------------------------------- Snapshot POS (cache hors ligne)
/** Catalogue complet pour la caisse, en une requête, mis en cache côté client (IndexedDB). */
export async function getPosCatalog(establishmentId: string) {
  const [categories, products, menus, taxRates, stations, paymentMethods] = await Promise.all([
    prisma.category.findMany({ where: { establishmentId, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, color: true, parentId: true, sortOrder: true, imageUrl: true } }),
    prisma.product.findMany({
      where: { establishmentId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, description: true, categoryId: true, priceTtc: true, costPrice: true, color: true, imageUrl: true, isAvailable: true, autoUnavailable: true, availability: true, sku: true, barcode: true, kitchenStationId: true, trackStock: true, stockQty: true,
        taxRate: { select: { id: true, name: true, rateBps: true } },
        variants: { where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, priceTtc: true } },
        modifierGroups: { orderBy: { sortOrder: "asc" }, select: { modifierGroup: { select: { id: true, name: true, minSelect: true, maxSelect: true, isActive: true, modifiers: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, priceDelta: true, isDefault: true, isAvailable: true } } } } } },
      },
    }),
    prisma.menu.findMany({ where: { establishmentId, isActive: true }, orderBy: { sortOrder: "asc" }, include: menuInclude }),
    listTaxRates(establishmentId),
    listKitchenStations(establishmentId),
    prisma.paymentMethodConfig.findMany({ where: { establishmentId, isEnabled: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    categories,
    products: products.map((p) => ({ ...p, modifierGroups: p.modifierGroups.map((g) => g.modifierGroup).filter((g) => g.isActive) })),
    menus,
    taxRates,
    stations,
    paymentMethods,
  };
}

// ---------------------------------------------------------------- Import CSV
export type ImportRow = { category: string; name: string; description?: string; priceTtc: number; taxRateBps?: number | null; costPrice?: number; sku?: string; isAvailable?: boolean };

export async function importProducts(actor: Actor, rows: ImportRow[]) {
  const taxRates = await listTaxRates(actor.establishmentId);
  const defaultTax = taxRates.find((t) => t.isDefault) ?? taxRates[0] ?? null;
  const categories = new Map((await listCategories(actor.establishmentId)).map((c) => [c.name.toLowerCase(), c.id]));
  let createdCount = 0, updatedCount = 0;
  const errors: { row: number; message: string }[] = [];
  for (const [i, row] of rows.entries()) {
    try {
      let categoryId = categories.get(row.category.toLowerCase());
      if (!categoryId) {
        const c = await upsertCategory(actor, { name: row.category });
        categoryId = c.id;
        categories.set(row.category.toLowerCase(), c.id);
      }
      let taxRateId = defaultTax?.id ?? null;
      if (row.taxRateBps !== null && row.taxRateBps !== undefined) {
        let t = taxRates.find((x) => x.rateBps === row.taxRateBps);
        if (!t) {
          t = await upsertTaxRate(actor, { name: `TVA ${row.taxRateBps / 100} %`, rateBps: row.taxRateBps });
          taxRates.push(t);
        }
        taxRateId = t.id;
      }
      const existing = row.sku ? await prisma.product.findFirst({ where: { establishmentId: actor.establishmentId, sku: row.sku } }) : null;
      const data = { name: row.name, description: row.description ?? null, categoryId, taxRateId, priceTtc: row.priceTtc, costPrice: row.costPrice ?? 0, sku: row.sku || null, isAvailable: row.isAvailable ?? true };
      if (existing) { await updateProduct(actor, existing.id, data); updatedCount++; }
      else { await createProduct(actor, data); createdCount++; }
    } catch (e) {
      errors.push({ row: i + 1, message: e instanceof Error ? e.message : "Erreur" });
    }
  }
  await audit({ ...actor, action: "catalog.import", entityType: "product", newValue: { createdCount, updatedCount, errors: errors.length } });
  return { createdCount, updatedCount, errors };
}
