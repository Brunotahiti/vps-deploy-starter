import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, cancelOrder, createOrder, getOrder, removeItem, sendCourse } from "@/server/services/orders";
import { addMovement, applyInventory, createPurchaseOrder, getRecipe, listIngredients, listMovements, receivePurchaseOrder, sendPurchaseOrder, setRecipe, stockAlerts, stockReport, suggestPurchase, upsertIngredient, upsertSupplier, upsertSupplierProduct, cancelPurchaseOrder } from "@/server/services/stock";
import { getPosCatalog } from "@/server/services/catalog";

let T: Awaited<ReturnType<typeof makeTenant>>;
let steak: string, pain: string, biereIng: string;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("stock");
  steak = (await upsertIngredient(T.managerActor, { name: "Steak haché", unit: "pce", stockMin: 5, avgCost: 300, isCritical: true })).id;
  pain = (await upsertIngredient(T.managerActor, { name: "Pain burger", unit: "pce", stockMin: 5, avgCost: 90 })).id;
  biereIng = (await upsertIngredient(T.managerActor, { name: "Bière 33 cl", unit: "pce", stockMin: 12, avgCost: 200, isCritical: true })).id;
  await addMovement(T.managerActor, { ingredientId: steak, kind: "PURCHASE", quantity: 10, unitCost: 300, reason: "Stock initial" });
  await addMovement(T.managerActor, { ingredientId: pain, kind: "PURCHASE", quantity: 10, unitCost: 90 });
  await addMovement(T.managerActor, { ingredientId: biereIng, kind: "PURCHASE", quantity: 2, unitCost: 200 });
});

describe("Phase 4 — stock", () => {
  it("recette : coût matière calculé et appliqué au produit", async () => {
    const r = await setRecipe(T.managerActor, T.burger.id, [{ ingredientId: steak, quantity: 1 }, { ingredientId: pain, quantity: 1 }], { applyCost: true });
    expect(r.computedCost).toBe(390);
    expect(r.marginPct).not.toBeNull();
    const p = await prisma.product.findUniqueOrThrow({ where: { id: T.burger.id } });
    expect(p.costPrice).toBe(390);
    await setRecipe(T.managerActor, T.biere.id, [{ ingredientId: biereIng, quantity: 1 }]);
    expect((await getRecipe(T.est.id, T.biere.id)).lines.length).toBe(1);
  });

  it("l'envoi en cuisine décrémente les ingrédients ; l'annulation d'un article les restitue", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 2 });
    const saignant = T.cuisson.modifiers.find((m) => m.name === "Saignant")!;
    await addItem(T.actor, o.id, { productId: T.burger.id, quantity: 2, modifiers: [{ modifierId: saignant.id }], courseId: o.courses[2].id });
    await addItem(T.actor, o.id, { productId: T.biere.id, courseId: o.courses[0].id });
    let ings = await listIngredients(T.est.id);
    expect(ings.find((i) => i.id === steak)!.stockQty).toBe(10);
    await sendCourse(T.actor, o.id, { all: true });
    ings = await listIngredients(T.est.id);
    expect(ings.find((i) => i.id === steak)!.stockQty).toBe(8);
    expect(ings.find((i) => i.id === pain)!.stockQty).toBe(8);
    expect(ings.find((i) => i.id === biereIng)!.stockQty).toBe(1);
    const sales = await listMovements(T.est.id, { kind: "SALE" });
    expect(sales.length).toBe(3);
    expect(sales.find((m) => m.ingredientId === steak)!.quantity).toBe(-2);
    expect(sales.find((m) => m.ingredientId === steak)!.value).toBe(600);
    // Annulation de l'article envoyé → restitution
    const full = await getOrder(T.est.id, o.id);
    const burgerItem = full.items.find((i) => i.name === "Burger")!;
    await removeItem(T.managerActor, o.id, burgerItem.id, "Erreur");
    ings = await listIngredients(T.est.id);
    expect(ings.find((i) => i.id === steak)!.stockQty).toBe(10);
    expect(ings.find((i) => i.id === pain)!.stockQty).toBe(10);
  });

  it("rupture automatique : ingrédient critique à zéro → produit indisponible, réapprovisionnement → disponible", async () => {
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.biere.id });
    await sendCourse(T.actor, o.id, { all: true });
    expect((await listIngredients(T.est.id)).find((i) => i.id === biereIng)!.stockQty).toBe(0);
    let product = await prisma.product.findUniqueOrThrow({ where: { id: T.biere.id } });
    expect(product.autoUnavailable).toBe(true);
    const catalog = await getPosCatalog(T.est.id);
    expect(catalog.products.find((p) => p.id === T.biere.id)!.autoUnavailable).toBe(true);
    await expect(addItem(T.actor, o.id, { productId: T.biere.id })).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    const alerts = await stockAlerts(T.est.id);
    expect(alerts.productsUnavailable.map((p) => p.id)).toContain(T.biere.id);
    expect(alerts.ingredients.some((i) => i.id === biereIng && i.out)).toBe(true);
    await addMovement(T.managerActor, { ingredientId: biereIng, kind: "PURCHASE", quantity: 24, unitCost: 180 });
    product = await prisma.product.findUniqueOrThrow({ where: { id: T.biere.id } });
    expect(product.autoUnavailable).toBe(false);
    const ing = (await listIngredients(T.est.id)).find((i) => i.id === biereIng)!;
    expect(ing.stockQty).toBe(24);
    expect(ing.avgCost).toBe(180); // stock nul avant : le coût moyen devient le coût d'achat
    expect(ing.lastCost).toBe(180);
  });

  it("perte avec motif obligatoire ; inventaire avec écart valorisé", async () => {
    await expect(addMovement(T.managerActor, { ingredientId: pain, kind: "LOSS", quantity: 2 })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await addMovement(T.managerActor, { ingredientId: pain, kind: "LOSS", quantity: 2, reason: "Moisi" });
    expect((await listIngredients(T.est.id)).find((i) => i.id === pain)!.stockQty).toBe(8);
    const inv = await applyInventory(T.managerActor, [{ ingredientId: pain, countedQty: 7 }, { ingredientId: steak, countedQty: 10 }], "Inventaire hebdo");
    expect(inv.lines.find((l) => l.ingredientId === pain)!.diff).toBe(-1);
    expect(inv.lines.find((l) => l.ingredientId === steak)!.diff).toBe(0);
    expect(inv.totalValue).toBe(-90);
    expect((await listIngredients(T.est.id)).find((i) => i.id === pain)!.stockQty).toBe(7);
    const invMoves = await listMovements(T.est.id, { kind: "INVENTORY" });
    expect(invMoves.length).toBe(1);
  });

  it("fournisseur, articles, bon de commande, réception partielle puis totale : stock et coût moyen mis à jour", async () => {
    const sup = await upsertSupplier(T.managerActor, { name: "Wing Chong", phone: "40 42 12 12" });
    const sp = await upsertSupplierProduct(T.managerActor, { supplierId: sup.id, ingredientId: steak, name: "Steaks × 20", packSize: 20, lastPrice: 6400 });
    let po = await createPurchaseOrder(T.managerActor, { supplierId: sup.id, lines: [{ supplierProductId: sp.id, quantity: 2 }] });
    expect(po.number).toMatch(/^BC-\d{8}-001$/);
    expect(po.total).toBe(12800);
    expect(po.status).toBe("DRAFT");
    po = await sendPurchaseOrder(T.managerActor, po.id);
    expect(po.status).toBe("SENT");
    po = await receivePurchaseOrder(T.managerActor, po.id, [{ lineId: po.lines[0].id, receivedQty: 1 }]);
    expect(po.status).toBe("PARTIALLY_RECEIVED");
    let ing = (await listIngredients(T.est.id)).find((i) => i.id === steak)!;
    expect(ing.stockQty).toBe(30); // 10 + 20
    expect(ing.avgCost).toBe(Math.round((10 * 300 + 20 * 320) / 30));
    po = await receivePurchaseOrder(T.managerActor, po.id, [{ lineId: po.lines[0].id, receivedQty: 2 }]);
    expect(po.status).toBe("RECEIVED");
    expect(po.receivedAt).not.toBeNull();
    ing = (await listIngredients(T.est.id)).find((i) => i.id === steak)!;
    expect(ing.stockQty).toBe(50);
    await expect(cancelPurchaseOrder(T.managerActor, po.id)).rejects.toMatchObject({ code: "PO_RECEIVED" });
    const purchases = await listMovements(T.est.id, { ingredientId: steak, kind: "PURCHASE" });
    expect(purchases.length).toBe(3);
  });

  it("suggestion de commande pour les ingrédients sous le seuil", async () => {
    const sup = (await prisma.supplier.findFirstOrThrow({ where: { establishmentId: T.est.id } }));
    await upsertSupplierProduct(T.managerActor, { supplierId: sup.id, ingredientId: pain, name: "Pains × 12", packSize: 12, lastPrice: 1080 });
    await addMovement(T.managerActor, { ingredientId: pain, kind: "LOSS", quantity: 4, reason: "Test" }); // 7 → 3 ≤ seuil 5
    const s = await suggestPurchase(T.est.id);
    expect(s.length).toBe(1);
    expect(s[0].lines[0].ingredient).toBe("Pain burger");
    expect(s[0].lines[0].suggestedPacks).toBeGreaterThanOrEqual(1);
  });

  it("annuler une commande envoyée restitue le stock ; rapport de période cohérent", async () => {
    const before = (await listIngredients(T.est.id)).find((i) => i.id === steak)!.stockQty;
    const o = await createOrder(T.actor, { type: "COUNTER" });
    const saignant = T.cuisson.modifiers.find((m) => m.name === "Saignant")!;
    await addItem(T.actor, o.id, { productId: T.burger.id, modifiers: [{ modifierId: saignant.id }] });
    await sendCourse(T.actor, o.id, { all: true });
    expect((await listIngredients(T.est.id)).find((i) => i.id === steak)!.stockQty).toBe(before - 1);
    await cancelOrder(T.managerActor, o.id, "Test");
    expect((await listIngredients(T.est.id)).find((i) => i.id === steak)!.stockQty).toBe(before);
    const report = await stockReport(T.est.id, new Date(Date.now() - 3600_000), new Date(Date.now() + 3600_000));
    expect(report.purchases).toBeGreaterThan(0);
    expect(report.losses).toBe(2 * 90 + 4 * 90);
    expect(report.stockValue).toBeGreaterThan(0);
    expect(report.topLosses[0].name).toBe("Pain burger");
    expect(report.movementsCount).toBeGreaterThan(5);
  });
});
