import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { getPeriodReport } from "./reports";
import type { Actor } from "./orders";

/** Phase 7 — Multi-sites : vue consolidée sur une période et copie de catalogue entre établissements. */
export async function organizationOverview(organizationId: string, fromDay: string, toDay: string) {
  const ests = await prisma.establishment.findMany({ where: { organizationId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, city: true, island: true, currency: true, timezone: true } });
  const rows = [];
  for (const e of ests) {
    const r = await getPeriodReport(e.id, fromDay, toDay, e.timezone, true);
    const openOrders = await prisma.order.count({ where: { establishmentId: e.id, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] } } });
    rows.push({ establishment: e, revenue: r.revenue, revenueHt: r.revenueHt, tickets: r.tickets, covers: r.covers, avgTicket: r.avgTicket, foodCostPct: r.foodCostPct, discounts: r.discounts, cancellations: r.cancellations, openOrders, previousRevenue: r.previous?.revenue ?? 0, byDay: r.byDay, topProducts: r.byProduct.slice(0, 5) });
  }
  const total = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, revenueHt: a.revenueHt + r.revenueHt, tickets: a.tickets + r.tickets, covers: a.covers + r.covers, previousRevenue: a.previousRevenue + r.previousRevenue }), { revenue: 0, revenueHt: 0, tickets: 0, covers: 0, previousRevenue: 0 });
  return { from: fromDay, to: toDay, rows, total: { ...total, avgTicket: total.tickets ? Math.round(total.revenue / total.tickets) : 0 } };
}

/** Copie catégories, taux de TVA, groupes d'options, produits (variantes, options) et formules d'un établissement vers un autre (par nom : pas de doublons). */
export async function copyCatalog(actor: Actor, fromId: string, toId: string, opts: { products?: boolean; menus?: boolean } = {}) {
  const [from, to] = await Promise.all([prisma.establishment.findFirst({ where: { id: fromId, organizationId: actor.organizationId } }), prisma.establishment.findFirst({ where: { id: toId, organizationId: actor.organizationId } })]);
  if (!from || !to || fromId === toId) throw new ApiError(400, "BAD_ESTABLISHMENT", "Établissements invalides");
  const stats = { categories: 0, taxRates: 0, modifierGroups: 0, products: 0, menus: 0 };
  await prisma.$transaction(async (tx) => {
    // Taux de TVA
    const taxMap = new Map<string, string>();
    for (const t of await tx.taxRate.findMany({ where: { establishmentId: fromId } })) {
      const existing = await tx.taxRate.findFirst({ where: { establishmentId: toId, rateBps: t.rateBps } });
      const row = existing ?? await tx.taxRate.create({ data: { establishmentId: toId, name: t.name, rateBps: t.rateBps, isDefault: t.isDefault, isActive: t.isActive } });
      if (!existing) stats.taxRates++;
      taxMap.set(t.id, row.id);
    }
    // Catégories (parents d'abord)
    const catMap = new Map<string, string>();
    const cats = await tx.category.findMany({ where: { establishmentId: fromId }, orderBy: { sortOrder: "asc" } });
    for (const c of [...cats.filter((c) => !c.parentId), ...cats.filter((c) => c.parentId)]) {
      const existing = await tx.category.findFirst({ where: { establishmentId: toId, name: c.name } });
      const row = existing ?? await tx.category.create({ data: { establishmentId: toId, name: c.name, color: c.color, sortOrder: c.sortOrder, isActive: c.isActive, imageUrl: c.imageUrl, parentId: c.parentId ? catMap.get(c.parentId) ?? null : null } });
      if (!existing) stats.categories++;
      catMap.set(c.id, row.id);
    }
    // Postes cuisine
    const stationMap = new Map<string, string>();
    for (const st of await tx.kitchenStation.findMany({ where: { establishmentId: fromId } })) {
      const existing = await tx.kitchenStation.findFirst({ where: { establishmentId: toId, name: st.name } });
      const row = existing ?? await tx.kitchenStation.create({ data: { establishmentId: toId, name: st.name, color: st.color, sortOrder: st.sortOrder, warnAfterSec: st.warnAfterSec, alertAfterSec: st.alertAfterSec } });
      stationMap.set(st.id, row.id);
    }
    // Groupes d'options
    const groupMap = new Map<string, string>();
    for (const g of await tx.modifierGroup.findMany({ where: { establishmentId: fromId }, include: { modifiers: { orderBy: { sortOrder: "asc" } } } })) {
      const existing = await tx.modifierGroup.findFirst({ where: { establishmentId: toId, name: g.name } });
      const row = existing ?? await tx.modifierGroup.create({ data: { establishmentId: toId, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, sortOrder: g.sortOrder, isActive: g.isActive, modifiers: { create: g.modifiers.map((m) => ({ name: m.name, priceDelta: m.priceDelta, isDefault: m.isDefault, isAvailable: m.isAvailable, sortOrder: m.sortOrder })) } } });
      if (!existing) stats.modifierGroups++;
      groupMap.set(g.id, row.id);
    }
    // Produits
    const productMap = new Map<string, string>();
    if (opts.products !== false) {
      for (const p of await tx.product.findMany({ where: { establishmentId: fromId, isActive: true }, include: { variants: true, modifierGroups: true } })) {
        const existing = await tx.product.findFirst({ where: { establishmentId: toId, name: p.name } });
        if (existing) { productMap.set(p.id, existing.id); continue; }
        const row = await tx.product.create({ data: {
          establishmentId: toId, name: p.name, description: p.description, categoryId: p.categoryId ? catMap.get(p.categoryId) ?? null : null, taxRateId: p.taxRateId ? taxMap.get(p.taxRateId) ?? null : null, kitchenStationId: p.kitchenStationId ? stationMap.get(p.kitchenStationId) ?? null : null,
          imageUrl: p.imageUrl, color: p.color, priceTtc: p.priceTtc, costPrice: p.costPrice, sku: null, barcode: null, isAvailable: true, availability: p.availability ?? undefined, sortOrder: p.sortOrder,
          variants: { create: p.variants.map((v) => ({ name: v.name, priceTtc: v.priceTtc, sortOrder: v.sortOrder, isActive: v.isActive })) },
          modifierGroups: { create: p.modifierGroups.map((mg) => ({ modifierGroupId: groupMap.get(mg.modifierGroupId)!, sortOrder: mg.sortOrder })).filter((x) => x.modifierGroupId) },
        } });
        productMap.set(p.id, row.id); stats.products++;
      }
    }
    // Formules
    if (opts.menus !== false && opts.products !== false) {
      for (const m of await tx.menu.findMany({ where: { establishmentId: fromId, isActive: true }, include: { sections: { include: { items: true }, orderBy: { sortOrder: "asc" } } } })) {
        if (await tx.menu.findFirst({ where: { establishmentId: toId, name: m.name } })) continue;
        await tx.menu.create({ data: { establishmentId: toId, name: m.name, description: m.description, priceTtc: m.priceTtc, taxRateId: m.taxRateId ? taxMap.get(m.taxRateId) ?? null : null, color: m.color, imageUrl: m.imageUrl, sortOrder: m.sortOrder, sections: { create: m.sections.map((s) => ({ name: s.name, minSelect: s.minSelect, maxSelect: s.maxSelect, sortOrder: s.sortOrder, items: { create: s.items.filter((i) => productMap.has(i.productId)).map((i) => ({ productId: productMap.get(i.productId)!, supplement: i.supplement, sortOrder: i.sortOrder })) } })) } } });
        stats.menus++;
      }
    }
    await audit({ ...actor, establishmentId: toId, action: "catalog.copy", entityType: "establishment", entityId: toId, newValue: { from: from.name, ...stats } }, tx);
  });
  publish("catalog.updated", toId, { copied: true });
  return stats;
}
