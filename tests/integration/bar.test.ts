import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, createOrder, getOrder, sendCourse, updateItem } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { activeHappyHour, barInventory, barReport, closeOffered, createTab, listCellar, listCocktails, listTabs, offerItem, recordBreakage, receiveBottles, setCocktail, unofferItem, updateBarSettings, upsertBottle, type HappyHour } from "@/server/services/bar";
import { localDay } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;
let U: Awaited<ReturnType<typeof makeTenant>>; // sans l'option Bar

const TZ = "Pacific/Tahiti";
const hh = (over: Partial<HappyHour> = {}): HappyHour => ({ id: "hh1", name: "Happy hour", days: [0, 1, 2, 3, 4, 5, 6], start: "17:00", end: "19:00", discountBps: 3000, categoryIds: [], productIds: [], enabled: true, ...over });
/** Créneau qui couvre l'heure locale actuelle (± 1 h), quel que soit le moment où le test tourne. */
function windowAroundNow() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).split(":").map(Number);
  const m = parts[0] * 60 + parts[1];
  const fmt = (x: number) => { const v = ((x % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`; };
  return { start: fmt(m - 60), end: fmt(m + 60) };
}

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("bar");
  U = await makeTenant("bar-sans-option", { options: ["stock"] });
});

describe("happy hour", () => {
  it("créneaux : jour, heure locale, créneau qui passe minuit, catégorie", () => {
    const s = { happyHours: [hh({ days: [5], categoryIds: ["c1"] }), hh({ id: "hh2", name: "Nuit", days: [5], start: "22:00", end: "01:00", discountBps: 2000, categoryIds: ["c1"] })] };
    // Vendredi 18 h à Tahiti (UTC−10) = samedi 4 h UTC
    expect(activeHappyHour(s, TZ, new Date("2026-10-03T04:00:00Z"), { categoryId: "c1" })?.name).toBe("Happy hour");
    expect(activeHappyHour(s, TZ, new Date("2026-10-03T04:00:00Z"), { categoryId: "autre" })).toBeNull();
    // Vendredi 19 h : terminé
    expect(activeHappyHour(s, TZ, new Date("2026-10-03T05:00:00Z"), { categoryId: "c1" })).toBeNull();
    // Samedi 0 h 30 : créneau de nuit commencé vendredi
    expect(activeHappyHour(s, TZ, new Date("2026-10-03T10:30:00Z"), { categoryId: "c1" })?.name).toBe("Nuit");
    // Boisson choisie une par une, hors des catégories du créneau
    const byProduct = { happyHours: [hh({ days: [5], productIds: ["p1"] })] };
    expect(activeHappyHour(byProduct, TZ, new Date("2026-10-03T04:00:00Z"), { id: "p1", categoryId: "c9" })?.name).toBe("Happy hour");
    expect(activeHappyHour(byProduct, TZ, new Date("2026-10-03T04:00:00Z"), { id: "p2", categoryId: "c9" })).toBeNull();
    // Samedi 18 h : pas de happy hour le samedi
    expect(activeHappyHour(s, TZ, new Date("2026-10-04T04:00:00Z"), { categoryId: "c1" })).toBeNull();
  });

  it("appliqué à l'ajout, suit la quantité, noté sur la ligne", async () => {
    await updateBarSettings(T.managerActor, { happyHours: [hh({ ...windowAroundNow(), categoryIds: [T.cat.id] })] });
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.biere.id, quantity: 2 });
    let order = await getOrder(T.est.id, o.id);
    const line = order.items[0];
    expect(line).toMatchObject({ discountKind: "HAPPY_HOUR", discountBps: 3000, discountNote: "Happy hour", discountAmount: 360, lineTotal: 840 });
    expect(order.total).toBe(840);
    await updateItem(T.actor, o.id, line.id, { quantity: 3 });
    order = await getOrder(T.est.id, o.id);
    expect(order.items[0]).toMatchObject({ quantity: 3, discountAmount: 540, lineTotal: 1260 });
    expect(order.total).toBe(1260);
  });

  it("choisi boisson par boisson : les autres produits de la catégorie gardent leur prix", async () => {
    await updateBarSettings(T.managerActor, { happyHours: [hh({ ...windowAroundNow(), productIds: [T.biere.id] })] });
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.biere.id });
    const order = await addItem(T.actor, o.id, { productId: T.eau.id });
    expect(order.items.find((i) => i.productId === T.biere.id)).toMatchObject({ discountKind: "HAPPY_HOUR", lineTotal: 420 });
    expect(order.items.find((i) => i.productId === T.eau.id)).toMatchObject({ discountKind: null, lineTotal: 300 });
  });

  it("sans l'option Bar : aucun happy hour, même réglé", async () => {
    await prisma.establishment.update({ where: { id: U.est.id }, data: { settings: { bar: { happyHours: [hh({ ...windowAroundNow(), categoryIds: [U.cat.id] })] } } } });
    const o = await createOrder(U.actor, { type: "COUNTER" });
    const order = await addItem(U.actor, o.id, { productId: U.biere.id });
    expect(order.items[0]).toMatchObject({ discountAmount: 0, discountKind: null });
  });

  it("réglages refusés : sans jour, sans boisson concernée, catégorie ou boisson d'un autre restaurant", async () => {
    await expect(updateBarSettings(T.managerActor, { happyHours: [hh({ days: [], categoryIds: [T.cat.id] })] })).rejects.toMatchObject({ code: "BAD_DAYS" });
    await expect(updateBarSettings(T.managerActor, { happyHours: [hh({ categoryIds: [] })] })).rejects.toMatchObject({ code: "BAD_TARGET" });
    await expect(updateBarSettings(T.managerActor, { happyHours: [hh({ productIds: [U.biere.id] })] })).rejects.toMatchObject({ code: "BAD_PRODUCT" });
    await expect(updateBarSettings(T.managerActor, { happyHours: [hh({ categoryIds: [U.cat.id] })] })).rejects.toMatchObject({ code: "BAD_CATEGORY" });
    await updateBarSettings(T.managerActor, { happyHours: [] });
  });
});

describe("ardoises et verres offerts", () => {
  it("ardoise au nom du client : listée tant qu'elle est ouverte, disparaît une fois réglée", async () => {
    const tab = await createTab(T.actor, { name: "Teva" });
    expect(tab).toMatchObject({ isTab: true, type: "COUNTER", customerName: "Teva" });
    await addItem(T.actor, tab.id, { productId: T.biere.id, quantity: 2 });
    await addItem(T.actor, tab.id, { productId: T.eau.id });
    const tabs = await listTabs(T.est.id);
    expect(tabs.find((t) => t.id === tab.id)).toMatchObject({ customerName: "Teva", total: 1500, items: 2 });
    await addPayments(T.actor, tab.id, [{ method: "CARD", amount: 1500 }]);
    expect((await listTabs(T.est.id)).some((t) => t.id === tab.id)).toBe(false);
  });

  it("offrir : motif obligatoire, ligne à 0, auteur noté ; annuler l'offre rend le prix ; l'ardoise reste ouverte", async () => {
    const tab = await createTab(T.actor, { name: "Hina" });
    const order = await addItem(T.actor, tab.id, { productId: T.biere.id });
    const item = order.items[0];
    await expect(offerItem(T.actor, tab.id, item.id, " ")).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    const offered = await offerItem({ ...T.actor, authorizedById: T.manager.id }, tab.id, item.id, "Anniversaire");
    expect(offered.items[0]).toMatchObject({ discountKind: "OFFERED", discountAmount: 600, lineTotal: 0, discountNote: "Anniversaire", discountById: T.manager.id });
    expect(offered).toMatchObject({ total: 0, status: "OPEN" }); // pas de clôture automatique
    await expect(offerItem(T.actor, tab.id, item.id, "Encore")).rejects.toMatchObject({ code: "ALREADY_OFFERED" });
    const back = await unofferItem(T.actor, tab.id, item.id);
    expect(back.items[0]).toMatchObject({ discountKind: null, discountAmount: 0, lineTotal: 600 });
    expect(back.total).toBe(600);
    await offerItem(T.actor, tab.id, item.id, "Anniversaire");
    const closed = await closeOffered(T.actor, tab.id);
    expect(closed.status).toBe("PAID");
  });

  it("formule : ses plats ne s'offrent pas un par un", async () => {
    const o = await createOrder(T.actor, { type: "COUNTER" });
    const cuisson = T.cuisson.modifiers.find((m) => m.isDefault)!;
    const order = await addItem(T.actor, o.id, { menuId: T.menu.id, menuSelections: T.menu.sections.map((s) => ({ sectionId: s.id, productId: s.items[0].productId, modifiers: s.items[0].productId === T.burger.id ? [{ modifierId: cuisson.id }] : [] })) });
    const component = order.items.find((i) => i.parentItemId)!;
    await expect(offerItem(T.actor, o.id, component.id, "Test")).rejects.toMatchObject({ code: "NOT_OFFERABLE" });
  });
});

describe("cave du bar et fiches cocktails", () => {
  let rhum: Awaited<ReturnType<typeof upsertBottle>>;
  let biere: Awaited<ReturnType<typeof upsertBottle>>;

  it("bouteilles au cl ou à la pièce : réception, stock en bouteilles, seuil d'alerte", async () => {
    rhum = await upsertBottle(T.managerActor, { name: "Rhum blanc", barKind: "spirit", unit: "cl", bottleMl: 700, minBottles: 1, bottleCost: 2800 });
    expect(rhum).toMatchObject({ unit: "cl", bottleMl: 700, stockMin: 70, unitCost: 40, bottleCost: 2800, low: true });
    await expect(upsertBottle(T.managerActor, { name: "Gin", barKind: "spirit", unit: "cl" })).rejects.toMatchObject({ code: "BOTTLE_SIZE" });
    rhum = await receiveBottles(T.managerActor, rhum.id, { bottles: 3, bottleCost: 2800 });
    expect(rhum).toMatchObject({ stockQty: 210, bottles: 3, low: false, value: 8400 });
    biere = await upsertBottle(T.managerActor, { name: "Bière bouteille", barKind: "beer", unit: "pce", minBottles: 12 });
    biere = await receiveBottles(T.managerActor, biere.id, { bottles: 24, bottleCost: 210 });
    expect(biere).toMatchObject({ stockQty: 24, bottles: 24 });
  });

  it("fiche cocktail : verre, garniture, préparation et doses ; chaque vente décompte la cave au cl", async () => {
    const card = await setCocktail(T.managerActor, T.biere.id, { glass: "Tumbler", garnish: "Citron vert", method: "Au shaker", doses: [{ ingredientId: rhum.id, quantity: 4 }] });
    expect(card).toMatchObject({ spec: { glass: "Tumbler", garnish: "Citron vert", method: "Au shaker" }, doses: [{ name: "Rhum blanc", unit: "cl", quantity: 4, cost: 160 }], doseCost: 160, hasCard: true });
    expect((await listCocktails(T.est.id)).some((c) => c.id === T.biere.id)).toBe(true);
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.biere.id, quantity: 2 });
    await sendCourse(T.actor, o.id, { all: true });
    const after = (await listCellar(T.est.id)).find((b) => b.id === rhum.id)!;
    expect(after.stockQty).toBe(202); // 210 − 2 × 4 cl
    await expect(setCocktail(T.managerActor, T.biere.id, { doses: [{ ingredientId: rhum.id, quantity: 4 }, { ingredientId: rhum.id, quantity: 2 }] })).rejects.toMatchObject({ code: "DUPLICATE_DOSE" });
    // Fiche vidée : plus de doses, plus de fiche
    const empty = await setCocktail(T.managerActor, T.biere.id, { glass: null, garnish: null, method: null, doses: [] });
    expect(empty === null || empty.hasCard === false).toBe(true);
  });

  it("casse et inventaire du bar : en bouteilles, entamée comprise ; écarts tracés", async () => {
    await expect(recordBreakage(T.actor, rhum.id, { quantity: 1, per: "bottle", reason: " " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    let r = await recordBreakage(T.actor, rhum.id, { quantity: 1, per: "bottle", reason: "Bouteille tombée" });
    expect(r.stockQty).toBe(132);
    r = (await barInventory(T.managerActor, [{ id: rhum.id, bottles: 1.75 }])).cellar.find((b) => b.id === rhum.id)!;
    expect(r).toMatchObject({ stockQty: 122.5, bottles: 1.75 });
    await expect(barInventory(T.managerActor, [{ id: U.biere.id, bottles: 1 }])).rejects.toMatchObject({ code: "BAD_INGREDIENT" });
  });
});

describe("rapport du bar", () => {
  it("boissons vendues, happy hour, offerts par motif et par personne, ardoises, casse", async () => {
    const today = localDay(new Date(), TZ);
    const r = await barReport(T.est.id, TZ, today, today);
    expect(r.tabs.count).toBeGreaterThanOrEqual(2);
    expect(r.offered.byReason.find((g) => g.key === "Anniversaire")).toMatchObject({ count: 1, value: 600 });
    expect(r.offered.byPerson[0].key).toBe("Server"); // offert par le serveur (offre fermée par closeOffered)
    expect(r.losses.rows.find((l) => l.name === "Rhum blanc")).toMatchObject({ quantity: 70, bottles: 1, value: 2800, reason: "Bouteille tombée" });
    expect(r.losses.value).toBeGreaterThanOrEqual(2800);
    expect(r.cellar.low.map((b) => b.name)).not.toContain("Rhum blanc");
  });
});
