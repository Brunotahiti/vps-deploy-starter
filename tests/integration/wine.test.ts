import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, cancelOrder, createOrder, getOrder, removeItem, sendCourse } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import {
  adjustOpenBottle, archiveWine, discardOpenBottle, getWine, listOpenBottles, listWines, openBottle, pairings, publicWineList, receiveWine, removeWine,
  setFormats, updateWineSettings, upsertWine, wineInventory, wineList, wineListPdf, wineReport,
} from "@/server/services/wine";
import { restaurantSite } from "@/server/services/public";
import { localDay } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;
let U: Awaited<ReturnType<typeof makeTenant>>;
const TZ = "Pacific/Tahiti";

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("cave");
  U = await makeTenant("cave-autre");
});

const base = { name: "Cuvée Prestige", producer: "Domaine des Tests", appellation: "Chablis", region: "Bourgogne", country: "France", color: "WHITE" as const, vintage: 2021, grapes: ["Chardonnay"] };

describe("fiches et cave", () => {
  it("création : stock dédié en cl, bouteilles, seuil, coût, réception, coût moyen", async () => {
    const w = await upsertWine(T.managerActor, null, { ...base, bottleMl: 750, minBottles: 2, bottleCost: 1500, location: "Casier A · rangée 2" });
    expect(w).toMatchObject({ label: "Domaine des Tests — Cuvée Prestige 2021", bottles: 0, minBottles: 2, bottleCost: 1500, low: true, out: true, location: "Casier A · rangée 2" });
    const ing = await prisma.ingredient.findUniqueOrThrow({ where: { id: w.ingredientId } });
    expect(ing).toMatchObject({ unit: "cl", bottleMl: 750, isCritical: true, barKind: null });
    const r1 = await receiveWine(T.managerActor, w.id, { bottles: 6, bottleCost: 1500 });
    expect(r1).toMatchObject({ bottles: 6, stockCl: 450, low: false, value: 9000 });
    const r2 = await receiveWine(T.managerActor, w.id, { bottles: 6, bottleCost: 2100, note: "Facture 42" });
    expect(r2).toMatchObject({ bottles: 12, bottleCost: 1800, value: 21600 });
    const detail = await getWine(T.est.id, w.id);
    expect(detail.movements[0]).toMatchObject({ kind: "PURCHASE", bottles: 6, reason: "Réception cave à vin · Facture 42" });
  });

  it("contenance verrouillée tant qu'il reste du vin ; apogée « de » avant « à » ; plat d'un autre restaurant refusé", async () => {
    const w = (await listWines(T.est.id))[0];
    await expect(upsertWine(T.managerActor, w.id, { ...base, bottleMl: 1500 })).rejects.toMatchObject({ code: "SIZE_LOCKED" });
    await expect(upsertWine(T.managerActor, null, { ...base, drinkFrom: 2030, drinkUntil: 2025 })).rejects.toMatchObject({ code: "BAD_WINDOW" });
    await expect(upsertWine(T.managerActor, w.id, { ...base, pairedProductIds: [U.burger.id] })).rejects.toMatchObject({ code: "BAD_PRODUCT" });
  });

  it("sorties (casse, motif obligatoire) et inventaire par bouteilles pleines", async () => {
    const w = (await listWines(T.est.id))[0];
    await expect(removeWine(T.actor, w.id, { bottles: 1, kind: "BREAKAGE", reason: " " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    expect(await removeWine(T.actor, w.id, { bottles: 1, kind: "BREAKAGE", reason: "Tombée en cave" })).toMatchObject({ bottles: 11 });
    const inv = await wineInventory(T.managerActor, [{ id: w.id, bottles: 10 }], "Casier A");
    expect(inv.lines[0]).toMatchObject({ before: 825, counted: 750, diff: -75 });
    expect(inv.wines[0].bottles).toBe(10);
  });
});

describe("formats de vente, vin au verre et accords", () => {
  it("formats : produits créés à la carte avec la bonne dose, mis à jour, retirés", async () => {
    const w = (await listWines(T.est.id))[0];
    const r = await setFormats(T.managerActor, w.id, { categoryId: T.cat.id, taxRateId: T.tax16.id, bottle: { priceTtc: 6500 }, glass: { priceTtc: 1200, ml: 120 }, carafe: { priceTtc: 3900, ml: 500 } });
    expect(r.formats.map((f) => [f.serving, f.ml, f.priceTtc]).sort()).toEqual([["BOTTLE", 750, 6500], ["CARAFE", 500, 3900], ["GLASS", 120, 1200]]);
    const glass = await prisma.product.findUniqueOrThrow({ where: { id: r.formats.find((f) => f.serving === "GLASS")!.productId }, include: { recipeLines: true } });
    expect(glass).toMatchObject({ name: "Domaine des Tests — Cuvée Prestige 2021 · verre 12 cl", costPrice: 288, taxRateId: T.tax16.id, categoryId: T.cat.id });
    expect(Number(glass.recipeLines[0].quantity)).toBe(12);
    await expect(setFormats(T.managerActor, w.id, { glass: { priceTtc: 1200, ml: 1000 } })).rejects.toMatchObject({ code: "BAD_ML" });
    const off = await setFormats(T.managerActor, w.id, { carafe: null });
    expect(off.formats.find((f) => f.serving === "CARAFE")?.isActive).toBe(false);
    const back = await setFormats(T.managerActor, w.id, { carafe: { priceTtc: 4000, ml: 500 } });
    expect(back.formats.filter((f) => f.serving === "CARAFE")).toHaveLength(1);
    expect(back.formats.find((f) => f.serving === "CARAFE")).toMatchObject({ isActive: true, priceTtc: 4000 });
  });

  it("verres vendus : versés de la bouteille ouverte, bouteille suivante ouverte toute seule, annulation reversée", async () => {
    const w = (await listWines(T.est.id))[0];
    const glass = w.formats.find((f) => f.serving === "GLASS")!;
    const carafe = w.formats.find((f) => f.serving === "CARAFE")!;
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: glass.productId, quantity: 2 });
    await sendCourse(T.actor, o.id, { all: true });
    let open = await listOpenBottles(T.est.id);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ remainingMl: 510, glassesLeft: 4, overdue: false });
    // Carafe de 50 cl : 51 cl dans la bouteille ouverte → il reste 1 cl
    await addItem(T.actor, o.id, { productId: carafe.productId });
    await sendCourse(T.actor, o.id, { all: true });
    open = await listOpenBottles(T.est.id);
    expect(open.map((b) => b.remainingMl)).toEqual([10]);
    // Un verre de plus : 1 cl de la bouteille entamée, 11 cl d'une nouvelle
    const o2 = await createOrder(T.actor, { type: "COUNTER" });
    const withGlass = await addItem(T.actor, o2.id, { productId: glass.productId });
    await sendCourse(T.actor, o2.id, { all: true });
    open = await listOpenBottles(T.est.id);
    expect(open.map((b) => b.remainingMl)).toEqual([640]);
    let wv = (await listWines(T.est.id))[0];
    // 750 − 24 − 50 − 12 = 664 cl en stock, dont 64 cl ouverts : 8 bouteilles pleines
    expect(wv).toMatchObject({ stockCl: 664, bottles: 8 });
    // Annulation du verre envoyé : le vin revient dans les bouteilles d'où il a été versé (1 cl et 11 cl)
    await removeItem(T.managerActor, o2.id, withGlass.items[0].id, "Erreur de saisie");
    open = await listOpenBottles(T.est.id);
    expect(open.map((b) => b.remainingMl).sort((a, b) => a - b)).toEqual([10, 750]);
    wv = (await listWines(T.est.id))[0];
    expect(wv.stockCl).toBe(676);
    await addPayments(T.actor, o.id, [{ method: "CARD", amount: (await getOrder(T.est.id, o.id)).total }]);
  });

  it("bouteille ouverte : ouverture manuelle, niveau corrigé, fin jetée en perte, alerte de conservation", async () => {
    const w = (await listWines(T.est.id))[0];
    const b = await openBottle(T.actor, w.id);
    await adjustOpenBottle(T.actor, b.id, 600);
    let wv = (await listWines(T.est.id))[0];
    expect(wv.stockCl).toBe(661);
    // Ouverte il y a 4 jours (blanc : 3 jours) → à écouler
    await prisma.wineOpenBottle.update({ where: { id: b.id }, data: { openedAt: new Date(Date.now() - 4 * 86_400_000) } });
    const overdue = (await listOpenBottles(T.est.id)).find((x) => x.id === b.id)!;
    expect(overdue).toMatchObject({ overdue: true, ageDays: 4, keepDays: 3 });
    await discardOpenBottle(T.actor, b.id, "Oxydé");
    wv = (await listWines(T.est.id))[0];
    expect(wv.stockCl).toBe(601);
    expect(wv.open).toHaveLength(2);
    const mv = await prisma.inventoryMovement.findFirst({ where: { ingredientId: w.ingredientId, kind: "LOSS" }, orderBy: { createdAt: "desc" } });
    expect(mv?.reason).toBe("Fin de bouteille ouverte jetée : Oxydé");
    await expect(discardOpenBottle(T.actor, b.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("accords mets-vins : le plat propose le vin et ses formats en vente", async () => {
    const w = (await listWines(T.est.id))[0];
    await upsertWine(T.managerActor, w.id, { ...base, pairedProductIds: [T.entree.id], pairingNotes: "Poisson cru, salade" });
    const map = await pairings(T.est.id);
    expect(map[T.entree.id]).toHaveLength(1);
    expect(map[T.entree.id][0]).toMatchObject({ wineId: w.id, color: "WHITE" });
    expect(map[T.entree.id][0].formats.map((f) => f.serving).sort()).toEqual(["BOTTLE", "CARAFE", "GLASS"]);
    expect(map[T.burger.id]).toBeUndefined();
    // Un vin ne s'accorde pas avec un autre vin
    await expect(upsertWine(T.managerActor, w.id, { ...base, pairedProductIds: [w.formats[0].productId] })).rejects.toMatchObject({ code: "BAD_PRODUCT" });
  });
});

describe("carte des vins, site et rapport", () => {
  it("carte par couleur et région, épuisés masqués ; PDF ; site public seulement si activé", async () => {
    const red = await upsertWine(T.managerActor, null, { name: "Rouge du test", color: "RED", region: "Rhône", bottleMl: 750 });
    await setFormats(T.managerActor, red.id, { categoryId: T.cat.id, bottle: { priceTtc: 5000 } });
    let list = await wineList(T.est.id);
    // Rouge sans stock : masqué ; le blanc est en vente
    expect(list.sections.map((s) => s.color)).toEqual(["WHITE"]);
    await receiveWine(T.managerActor, red.id, { bottles: 3 });
    list = await wineList(T.est.id);
    expect(list.sections.map((s) => s.color)).toEqual(["RED", "WHITE"]);
    expect(list.sections[1].regions[0]).toMatchObject({ region: "Bourgogne" });
    const pdf = await wineListPdf(T.est.id);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");

    expect(await publicWineList(T.est.id)).toBeNull();
    await updateWineSettings(T.managerActor, { showOnSite: true, listIntro: "Une sélection de vignerons." });
    const pub = await publicWineList(T.est.id);
    expect(pub).toMatchObject({ title: "Carte des vins", intro: "Une sélection de vignerons." });
    expect(JSON.stringify(pub)).not.toMatch(/cost|stock/i);
    const site = await restaurantSite(T.org.slug, T.est.slug);
    expect(site.wine?.sections.length).toBe(2);
    // Sans l'option : pas de carte des vins sur le site, même activée
    await prisma.organization.update({ where: { id: T.org.id }, data: { options: { set: T.org.options.filter((o) => o !== "wine") } } });
    expect((await restaurantSite(T.org.slug, T.est.slug)).wine).toBeNull();
    await prisma.organization.update({ where: { id: T.org.id }, data: { options: { set: T.org.options } } });
  });

  it("rapport : ventes par format, chiffre d'affaires HT, marge, pertes et vins dormants", async () => {
    const today = localDay(new Date(), TZ);
    const r = await wineReport(T.est.id, TZ, today, today);
    const white = r.rows.find((x) => x.color === "WHITE")!;
    expect(white).toMatchObject({ glasses: 2, carafes: 1, bottles: 0 });
    expect(white.revenue).toBe(2 * 1200 + 4000);
    expect(white.margin).toBe(white.revenueHt - white.cost);
    expect(r.totals.litres).toBe(0.7);
    expect(r.losses.discardedBottles).toBe(1);
    expect(r.losses.discardedMl).toBe(600);
    expect(r.losses.rows.some((x) => x.kind === "BREAKAGE")).toBe(true);
    expect(r.cellar.dormant.map((d) => d.label)).toContain("Rouge du test");
  });

  it("archivage : la fiche et ses formats disparaissent de la carte", async () => {
    const red = (await listWines(T.est.id)).find((w) => w.color === "RED")!;
    await archiveWine(T.managerActor, red.id);
    expect((await listWines(T.est.id)).find((w) => w.id === red.id)).toBeUndefined();
    expect((await wineList(T.est.id)).sections.map((s) => s.color)).toEqual(["WHITE"]);
    expect(await prisma.product.count({ where: { wineId: red.id, isActive: true } })).toBe(0);
  });

  it("une commande annulée avant envoi ne touche pas aux bouteilles ouvertes", async () => {
    const w = (await listWines(T.est.id)).find((x) => x.color === "WHITE")!;
    const before = (await listOpenBottles(T.est.id)).map((b) => b.remainingMl);
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: w.formats.find((f) => f.serving === "GLASS")!.productId });
    await cancelOrder(T.managerActor, o.id, "Client parti");
    expect((await listOpenBottles(T.est.id)).map((b) => b.remainingMl)).toEqual(before);
  });
});
