import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, createOrder, sendCourse } from "@/server/services/orders";
import { addMovement, getPreparation, getRecipe, listIngredients, listMovements, listPreparations, producePreparation, setPreparation, setRecipe, upsertIngredient } from "@/server/services/stock";
import { buildExport } from "@/server/reports/export";
import { localDay } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;
let mayo: string, ketchup: string, oignon: string, sauce: string;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("prepa");
  mayo = (await upsertIngredient(T.managerActor, { name: "Mayonnaise", unit: "g", avgCost: 1 })).id; // 1 F / g
  ketchup = (await upsertIngredient(T.managerActor, { name: "Ketchup", unit: "g", avgCost: 1 })).id;
  oignon = (await upsertIngredient(T.managerActor, { name: "Oignon", unit: "g", avgCost: 1 })).id;
  for (const [id, qty, cost] of [[mayo, 2000, 1], [ketchup, 1000, 1], [oignon, 500, 1]] as const) await addMovement(T.managerActor, { ingredientId: id, kind: "PURCHASE", quantity: qty, unitCost: cost });
  sauce = (await upsertIngredient(T.managerActor, { name: "Sauce burger", unit: "l", isPreparation: true, yieldQty: 0.75, stockMin: 0.5 })).id;
});

describe("Préparations maison (plusieurs ingrédients → une sauce)", () => {
  it("composition d'un lot : coût du lot, coût par unité et lots réalisables", async () => {
    const p = await setPreparation(T.managerActor, sauce, { lines: [{ ingredientId: mayo, quantity: 500 }, { ingredientId: ketchup, quantity: 200 }, { ingredientId: oignon, quantity: 50 }] });
    expect(p.isPreparation).toBe(true);
    expect(p.yieldQty).toBe(0.75);
    expect(p.batchCost).toBe(750); // 500 + 200 + 50 à 1 F le gramme
    expect(p.unitCost).toBe(1000); // 750 F pour 0,75 l
    expect(p.producibleBatches).toBe(4); // mayo 2000/500 = 4, ketchup 1000/200 = 5, oignon 500/50 = 10
    expect((await listPreparations(T.est.id)).map((x) => x.name)).toEqual(["Sauce burger"]);
    const listed = (await listIngredients(T.est.id)).find((i) => i.id === sauce)!;
    expect(listed.isPreparation).toBe(true);
    expect(listed._count.composition).toBe(3);
  });

  it("refuse les boucles : une préparation ne peut pas se contenir, même via une autre préparation", async () => {
    await expect(setPreparation(T.managerActor, sauce, { lines: [{ ingredientId: sauce, quantity: 1 }] })).rejects.toMatchObject({ code: "PREPARATION_CYCLE" });
    const special = (await upsertIngredient(T.managerActor, { name: "Sauce spéciale", unit: "l", isPreparation: true, yieldQty: 1 })).id;
    await setPreparation(T.managerActor, special, { lines: [{ ingredientId: sauce, quantity: 0.5 }, { ingredientId: ketchup, quantity: 100 }] }); // une préparation dans une autre : autorisé
    await expect(setPreparation(T.managerActor, sauce, { lines: [{ ingredientId: special, quantity: 0.1 }] })).rejects.toMatchObject({ code: "PREPARATION_CYCLE" });
    // Composition inchangée après le refus
    expect((await getPreparation(T.est.id, sauce)).lines.length).toBe(3);
    // Un ingrédient d'un autre établissement est refusé
    const B = await makeTenant("prepa-b");
    const other = (await upsertIngredient(B.managerActor, { name: "Ailleurs", unit: "g" })).id;
    await expect(setPreparation(T.managerActor, sauce, { lines: [{ ingredientId: other, quantity: 1 }] })).rejects.toMatchObject({ code: "BAD_INGREDIENT" });
    await expect(getPreparation(B.est.id, sauce)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("produire 2 lots : les composants sortent, la sauce entre à son coût réel, mouvements PRODUCTION tracés", async () => {
    const r = await producePreparation(T.managerActor, sauce, { batches: 2, reason: "Mise en place du midi" });
    expect(r.produced).toBe(1.5);
    expect(r.cost).toBe(1500);
    expect(r.unitCost).toBe(1000);
    expect(r.preparation.stockQty).toBe(1.5);
    expect(r.preparation.avgCost).toBe(1000);
    expect(r.preparation.producibleBatches).toBe(2); // il reste 1 000 g de mayonnaise
    const ings = await listIngredients(T.est.id);
    expect(ings.find((i) => i.id === mayo)!.stockQty).toBe(1000);
    expect(ings.find((i) => i.id === ketchup)!.stockQty).toBe(600);
    expect(ings.find((i) => i.id === oignon)!.stockQty).toBe(400);
    const moves = await listMovements(T.est.id, { kind: "PRODUCTION" });
    expect(moves).toHaveLength(4);
    expect(moves.find((m) => m.ingredientId === sauce)).toMatchObject({ quantity: 1.5, unitCost: 1000, reason: "Mise en place du midi" });
    expect(moves.find((m) => m.ingredientId === mayo)).toMatchObject({ quantity: -1000, reason: "Production Sauce burger" });
    // Le coût moyen de la sauce se pondère : les composants deviennent plus chers → nouveau lot plus cher
    await addMovement(T.managerActor, { ingredientId: mayo, kind: "PURCHASE", quantity: 1000, unitCost: 3 }); // mayo : (1000×1 + 1000×3)/2000 = 2 F/g
    const r2 = await producePreparation(T.managerActor, sauce, { batches: 1 });
    expect(r2.cost).toBe(1250); // 500×2 + 200 + 50
    expect(r2.preparation.stockQty).toBe(2.25);
    expect(r2.preparation.avgCost).toBe(Math.round((1.5 * 1000 + 0.75 * Math.round(1250 / 0.75)) / 2.25));
    await expect(producePreparation(T.managerActor, sauce, { batches: 0 })).rejects.toMatchObject({ code: "BAD_QUANTITY" });
    await expect(producePreparation(T.managerActor, mayo, { batches: 1 })).rejects.toMatchObject({ code: "NO_COMPOSITION" });
  });

  it("la préparation s'utilise dans la recette d'un plat : coût matière et décrémentation à l'envoi en cuisine", async () => {
    const before = (await getPreparation(T.est.id, sauce)).stockQty;
    const recipe = await setRecipe(T.managerActor, T.burger.id, [{ ingredientId: sauce, quantity: 0.03 }], { applyCost: true }); // 3 cl de sauce par burger
    const prepCost = (await getPreparation(T.est.id, sauce)).avgCost;
    expect(recipe.computedCost).toBe(Math.round(0.03 * prepCost));
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 2 });
    const saignant = T.cuisson.modifiers.find((m) => m.name === "Saignant")!;
    await addItem(T.actor, o.id, { productId: T.burger.id, quantity: 2, modifiers: [{ modifierId: saignant.id }], courseId: o.courses[2].id });
    await sendCourse(T.actor, o.id, { all: true });
    expect((await getPreparation(T.est.id, sauce)).stockQty).toBe(Math.round((before - 0.06) * 1000) / 1000);
    expect((await getRecipe(T.est.id, T.burger.id)).lines[0].name).toBe("Sauce burger");
    // Export du stock : la préparation est signalée comme telle, la production apparaît dans les mouvements
    const today = localDay(new Date(), "Pacific/Tahiti");
    const exp = await buildExport(T.est.id, "stock", today, today, "Pacific/Tahiti");
    expect(exp.sheets[0].rows.find((r) => r[0] === "Sauce burger")![1]).toBe("Préparation");
    expect(exp.sheets[1].rows.filter((r) => r[3] === "Production").length).toBeGreaterThanOrEqual(4);
    expect(await prisma.auditLog.count({ where: { action: "preparation.produce" } })).toBe(2);
  });
});
