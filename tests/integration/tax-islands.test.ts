import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { createProduct, listTaxRates, switchCatalogTaxRate, upsertCategory, upsertTaxRate } from "@/server/services/catalog";
import { addItem, createOrder } from "@/server/services/orders";
import { suggestKeepRate } from "@/lib/tax-presets";

let T: Awaited<ReturnType<typeof makeTenant>>;
let U: Awaited<ReturnType<typeof makeTenant>>;
let desserts: string, alcools: string, gateau: string, rhum: string;
beforeAll(async () => {
  await resetDb();
  T = await makeTenant("tva-iles");
  U = await makeTenant("tva-iles-autre");
  desserts = (await upsertCategory(T.managerActor, { name: "Desserts" })).id;
  alcools = (await upsertCategory(T.managerActor, { name: "Bières & alcools" })).id;
  gateau = (await createProduct(T.managerActor, { name: "Gâteau coco", priceTtc: 800, costPrice: 200, categoryId: desserts, taxRateId: T.tax13.id })).id;
  rhum = (await createProduct(T.managerActor, { name: "Ti punch", priceTtc: 900, costPrice: 200, categoryId: alcools, taxRateId: T.tax16.id })).id;
});

const rateOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id }, include: { taxRate: true } })).taxRate?.rateBps ?? null;

describe("TVA des îles : toute la carte à 1 %, hors sucré et alcool", () => {
  it("propose de garder le taux actuel pour les catégories sucrées ou alcoolisées", () => {
    expect(["Desserts", "Bières & alcools", "Vins", "Cocktails", "Glaces", "Sodas & jus sucrés", "Pâtisseries"].every(suggestKeepRate)).toBe(true);
    expect(["Plats", "Entrées", "Poissons crus", "Burgers", "Salades"].some(suggestKeepRate)).toBe(false);
    expect(suggestKeepRate("Boissons")).toBe(true); // surtout sodas et alcools : décochable
  });

  it("bascule la carte au nouveau taux, garde les catégories choisies, les exonérés et les commandes passées", async () => {
    const o = await createOrder(T.actor, { type: "TAKEAWAY" });
    await addItem(T.actor, o.id, { productId: T.entree.id, quantity: 1 });

    const r = await switchCatalogTaxRate(T.managerActor, { name: "TVA îles", rateBps: 100, keepCategoryIds: [desserts, alcools] });
    expect(r.taxRate).toMatchObject({ name: "TVA îles", rateBps: 100, isDefault: true });
    expect(await rateOf(T.burger.id)).toBe(100);
    expect(await rateOf(T.entree.id)).toBe(100);
    expect(await rateOf(T.biere.id)).toBe(100); // dans la catégorie non gardée : basculée (le gérant l'ajuste au besoin)
    expect(await rateOf(T.eau.id)).toBe(0); // exonérée : inchangée
    expect(await rateOf(gateau)).toBe(1300); // dessert : taux d'origine
    expect(await rateOf(rhum)).toBe(1600); // alcool : taux d'origine
    expect((await prisma.menu.findUniqueOrThrow({ where: { id: T.menu.id }, include: { taxRate: true } })).taxRate?.rateBps).toBe(100);
    expect(r.products).toBe(3);
    expect(r.menus).toBe(1);
    expect(r.keptProducts).toBe(2);
    expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } })).taxRateBps).toBe(1300); // déjà commandé

    // Une nouvelle vente prend 1 %
    const o2 = await createOrder(T.actor, { type: "TAKEAWAY" });
    await addItem(T.actor, o2.id, { productId: T.entree.id, quantity: 1 });
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: o2.id } });
    expect(item.taxRateBps).toBe(100);
    expect(item.taxAmount).toBe(Math.round(1200 - 1200 / 1.01));

    // Rejouer ne crée pas de second taux à 1 %
    await switchCatalogTaxRate(T.managerActor, { name: "TVA îles bis", rateBps: 100, keepCategoryIds: [desserts, alcools] });
    expect((await listTaxRates(T.est.id)).filter((t) => t.rateBps === 100)).toHaveLength(1);
    expect((await listTaxRates(T.est.id)).filter((t) => t.isDefault).map((t) => t.rateBps)).toEqual([100]);
    expect(await prisma.auditLog.count({ where: { action: "catalog.tax_rate.switch", establishmentId: T.est.id } })).toBe(2);
  });

  it("un taux existant se modifie aussi directement (ex. TVA restauration 13 % → 1 %)", async () => {
    const r = await upsertTaxRate(U.managerActor, { id: U.tax13.id, name: "TVA restauration îles", rateBps: 100 });
    expect(r.rateBps).toBe(100);
    expect(await rateOf(U.burger.id)).toBe(100);
  });

  it("refuse une catégorie d'un autre restaurant et ne touche pas aux autres restaurants", async () => {
    const otherCat = (await upsertCategory(U.managerActor, { name: "Desserts" })).id;
    await expect(switchCatalogTaxRate(T.managerActor, { name: "TVA îles", rateBps: 100, keepCategoryIds: [otherCat] })).rejects.toMatchObject({ code: "BAD_CATEGORY" });
    expect(await rateOf(U.biere.id)).toBe(1600);
  });
});
