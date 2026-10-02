import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addDays, localDay, zonedInputToDate } from "@/lib/dates";
import { forecast } from "@/server/services/forecast";
import { createQualityReport, listAiReports, qualityIndicators, QualityReportSchema } from "@/server/services/quality";
import { createProposedOrders, proposePurchase, weekAdvice } from "@/server/services/ai-assistant";
import { upsertIngredient, upsertSupplier, upsertSupplierProduct } from "@/server/services/stock";
import { aiStructured, isAiConfigured } from "@/server/ai/claude";

let T: Awaited<ReturnType<typeof makeTenant>>;
const TZ = "Pacific/Tahiti";
const today = () => localDay(new Date(), TZ);
const saved = process.env.AI_TRANSPORT;

/** Journée passée : `covers` couverts sur place le soir, `takeaway` commandes à emporter le midi */
async function pastDay(day: string, covers: number, takeaway: number) {
  const at = (hhmm: string) => zonedInputToDate(`${day}T${hhmm}`, TZ);
  let n = 0;
  const mk = (type: "DINE_IN" | "TAKEAWAY", c: number, time: string) => prisma.order.create({ data: { establishmentId: T.est.id, number: `${day.replace(/-/g, "")}-${String(++n).padStart(4, "0")}`, type, status: "PAID", covers: c, total: 3000 * c, openedAt: at(time), closedAt: at(time) } });
  for (let i = 0; i < covers / 4; i++) await mk("DINE_IN", 4, "19:30");
  for (let i = 0; i < takeaway; i++) await mk("TAKEAWAY", 1, "12:00");
}

beforeAll(async () => {
  process.env.AI_TRANSPORT = "fake";
  await resetDb();
  T = await makeTenant("ia");
  // 8 semaines : vendredis chargés (40 couverts), autres jours calmes (8), dimanches fermés
  for (let i = 56; i >= 1; i--) {
    const d = addDays(today(), -i);
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow === 0) continue;
    await pastDay(d, dow === 5 ? 40 : 8, dow === 5 ? 6 : 2);
  }
});
afterAll(() => { process.env.AI_TRANSPORT = saved; });

describe("Assistant IA", () => {
  it("prévisions façon Bison Futé : vendredi chargé, autres jours calmes, dimanche fermé, réservations prises en compte", async () => {
    const f = await forecast(T.est.id, TZ, 14);
    expect(f.historyDays).toBeGreaterThan(40);
    const dowOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
    const friday = f.days.find((d) => dowOf(d.day) === 5)!;
    const monday = f.days.find((d) => dowOf(d.day) === 1)!;
    const sunday = f.days.find((d) => dowOf(d.day) === 0)!;
    expect(["red", "black"]).toContain(friday.level);
    expect(friday.expected.clients).toBeGreaterThanOrEqual(44);
    expect(friday.expected.dinner).toBeGreaterThan(friday.expected.lunch);
    expect(monday.level).toBe("green");
    expect(sunday.closed).toBe(true);
    // Un lundi avec 30 couverts réservés devient une journée chargée
    await prisma.reservation.create({ data: { establishmentId: T.est.id, name: "Groupe", startsAt: zonedInputToDate(`${monday.day}T19:00`, TZ), partySize: 30, status: "CONFIRMED" } });
    const again = (await forecast(T.est.id, TZ, 14)).days.find((d) => d.day === monday.day)!;
    expect(again.booked.covers).toBe(30);
    expect(again.expected.covers).toBeGreaterThanOrEqual(30);
    expect(["orange", "red", "black"]).toContain(again.level);
  });

  it("analyse qualité : indicateurs comparés, rapport conforme au schéma, gardé et limité à 3 par jour", async () => {
    const ind = await qualityIndicators(T.est.id, TZ);
    expect(ind.current.ventes.tickets).toBeGreaterThan(0);
    expect(ind.current.ventes.couverts).toBeGreaterThan(0);
    const r = await createQualityReport(T.managerActor, TZ);
    expect(QualityReportSchema.safeParse(r.report).success).toBe(true);
    expect(r.report.chapitres.map((c) => c.chapitre.split(" ")[0])).toEqual(["4", "5", "6", "7", "8", "9", "10"]);
    expect((await listAiReports(T.est.id, "quality"))[0].id).toBe(r.id);
    await createQualityReport(T.managerActor, TZ);
    await createQualityReport(T.managerActor, TZ);
    await expect(createQualityReport(T.managerActor, TZ)).rejects.toMatchObject({ status: 429, code: "AI_DAILY_LIMIT" });
    expect(await prisma.auditLog.count({ where: { action: "ai.quality_report" } })).toBe(3);
  });

  it("conseils de la semaine à partir des prévisions", async () => {
    const w = await weekAdvice(T.managerActor, TZ);
    expect(w.advice.titre).toBeTruthy();
    expect(w.advice.jours.length).toBeGreaterThan(0);
  });

  it("commande proposée : selon la consommation et l'activité prévue, en colis entiers, chez le moins cher", async () => {
    const tomate = await upsertIngredient(T.managerActor, { name: "Tomate", unit: "kg", stockMin: 2 });
    await prisma.ingredient.update({ where: { id: tomate.id }, data: { stockQty: 3 } });
    // 28 kg consommés en 4 semaines : 1 kg par jour
    await prisma.inventoryMovement.create({ data: { establishmentId: T.est.id, ingredientId: tomate.id, kind: "SALE", quantity: -28, createdAt: new Date(Date.now() - 3 * 86400000) } });
    const cher = await upsertSupplier(T.managerActor, { name: "Primeur cher" });
    const malin = await upsertSupplier(T.managerActor, { name: "Marché de Papeete" });
    await upsertSupplierProduct(T.managerActor, { supplierId: cher.id, ingredientId: tomate.id, name: "Tomates colis 5 kg", packSize: 5, lastPrice: 4000 });
    await upsertSupplierProduct(T.managerActor, { supplierId: malin.id, ingredientId: tomate.id, name: "Tomates cagette 6 kg", packSize: 6, lastPrice: 3000 });
    const p = await proposePurchase(T.est.id, TZ);
    const line = p.groups.flatMap((g) => g.lines.map((l) => ({ ...l, supplier: g.supplier.name }))).find((l) => l.ingredient === "Tomate")!;
    expect(line.supplier).toBe("Marché de Papeete");
    expect(line.dailyUse).toBeGreaterThan(0);
    expect(line.daysLeft).toBeLessThanOrEqual(3);
    expect(line.packs * line.packSize).toBeGreaterThanOrEqual(line.need);
    const created = await createProposedOrders(T.managerActor, TZ, [malin.id]);
    expect(created).toHaveLength(1);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: created[0].id } })).status).toBe("DRAFT");
  });

  it("sans clé : l'IA n'est pas branchée, avec un message clair", async () => {
    process.env.AI_TRANSPORT = "";
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(isAiConfigured()).toBe(false);
    await expect(aiStructured({ schema: QualityReportSchema, system: "", prompt: "", fake: () => { throw new Error("non"); } })).rejects.toMatchObject({ status: 503, code: "AI_NOT_CONFIGURED" });
    if (key) process.env.ANTHROPIC_API_KEY = key;
    process.env.AI_TRANSPORT = "fake";
  });
});
