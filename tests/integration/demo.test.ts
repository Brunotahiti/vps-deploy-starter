import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { createProduct, upsertCategory } from "@/server/services/catalog";
import { addItem, createOrder } from "@/server/services/orders";
import { localDay, startOfLocalDay } from "@/lib/dates";
import { DEMO_SLUG, dayPlan, loadDemoContext, refreshDemo } from "../../prisma/demo-activity";

let T: Awaited<ReturnType<typeof makeTenant>>;
const TZ = "Pacific/Tahiti";
const db = prisma as unknown as Parameters<typeof refreshDemo>[0];

beforeAll(async () => {
  await resetDb();
  T = await makeTenant(DEMO_SLUG);
  await prisma.establishment.update({ where: { id: T.est.id }, data: { timezone: TZ } });
  // La démo a besoin d'une carte de boissons et de quelques entrées et desserts
  const boissons = await upsertCategory(T.managerActor, { name: "Boissons" });
  await createProduct(T.managerActor, { name: "Eau minérale 50 cl", priceTtc: 350, costPrice: 90, categoryId: boissons.id, taxRateId: T.tax0.id });
  await createProduct(T.managerActor, { name: "Hinano", priceTtc: 600, costPrice: 210, categoryId: boissons.id, taxRateId: T.tax16.id });
  await prisma.employee.create({ data: { establishmentId: T.est.id, userId: T.server.id, firstName: "Server", lastName: "Démo", jobTitle: "Serveur", hourlyCost: 1650 } });
  for (let i = 3; i <= 20; i++) await prisma.table.create({ data: { establishmentId: T.est.id, roomId: T.room.id, name: `T${String(i).padStart(2, "0")}`, seats: 4 } });
});
afterAll(() => { vi.useRealTimers(); });

const openSessions = () => prisma.cashSession.count({ where: { establishmentId: T.est.id, status: "OPEN" } });
const totals = async () => {
  const [paid, open, sessions] = await Promise.all([
    prisma.order.count({ where: { establishmentId: T.est.id, status: "PAID" } }),
    prisma.order.count({ where: { establishmentId: T.est.id, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] } } }),
    prisma.cashSession.count({ where: { establishmentId: T.est.id } }),
  ]);
  return { paid, open, sessions };
};

describe("Démo vivante", () => {
  it("le plan d'une journée est reproductible", async () => {
    const ctx = (await loadDemoContext(db))!;
    const a = dayPlan(ctx, "2026-09-12"), b = dayPlan(ctx, "2026-09-12");
    expect(a.length).toBeGreaterThan(10);
    expect(a.map((o) => [o.openAt.getTime(), o.items.length, o.method])).toEqual(b.map((o) => [o.openAt.getTime(), o.items.length, o.method]));
    expect(new Set(a.map((o) => o.type))).toContain("DINE_IN");
  });

  it("génère l'historique, le service du jour, et reste identique quand on relance", async () => {
    const r = await refreshDemo(db, { historyDays: 3 });
    expect(r?.generated).toBe(3);
    const today = localDay(new Date(), TZ);
    const todayStart = startOfLocalDay(today, TZ);
    // 3 journées clôturées, la caisse du jour ouverte
    expect(await prisma.cashSession.count({ where: { establishmentId: T.est.id, status: "CLOSED" } })).toBe(3);
    expect(await openSessions()).toBe(1);
    // Ventes du jour déjà encaissées, tables en cours avec tickets cuisine, commandes en ligne à accepter
    expect(await prisma.order.count({ where: { establishmentId: T.est.id, status: "PAID", closedAt: { gte: todayStart } } })).toBeGreaterThanOrEqual(6);
    expect(await prisma.kitchenTicket.count({ where: { order: { establishmentId: T.est.id }, status: { in: ["NEW", "ACCEPTED", "IN_PROGRESS", "READY"] } } })).toBeGreaterThan(0);
    expect(await prisma.order.count({ where: { establishmentId: T.est.id, type: { in: ["ONLINE", "DELIVERY"] }, status: "OPEN" } })).toBe(2);
    // Chaque clôture de caisse est tracée dans le journal d'audit
    expect(await prisma.auditLog.count({ where: { establishmentId: T.est.id, action: "cash.close" } })).toBe(3);
    // Réservations passées et à venir, planning des prochains jours
    expect(await prisma.reservation.count({ where: { establishmentId: T.est.id, startsAt: { gt: new Date() } } })).toBeGreaterThan(0);
    expect(await prisma.shift.count({ where: { establishmentId: T.est.id, startsAt: { gt: new Date(Date.now() + 86400000) } } })).toBeGreaterThan(0);

    // Comptes clients pro : comptes fictifs et consommations sur compte à facturer
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: T.org.id } })).options).toContain("accounts");
    expect(await prisma.customerAccount.count({ where: { establishmentId: T.est.id } })).toBe(3);
    // Marketing : cartes cadeaux et clients inscrits aux offres
    expect(await prisma.giftCard.count({ where: { establishmentId: T.est.id } })).toBe(3);
    // Hygiène : option ouverte, relevés et nettoyages des jours passés, traçabilité en cours
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: T.org.id } })).options).toContain("hygiene");
    expect(await prisma.temperatureReading.count({ where: { establishmentId: T.est.id, takenAt: { lt: todayStart } } })).toBeGreaterThan(50);
    expect(await prisma.temperatureReading.count({ where: { establishmentId: T.est.id, compliant: false, correctiveAction: { not: null } } })).toBe(1);
    expect(await prisma.cleaningLog.count({ where: { establishmentId: T.est.id } })).toBeGreaterThan(50);
    expect(await prisma.traceRecord.count({ where: { establishmentId: T.est.id, closedAt: null } })).toBeGreaterThan(0);
    const hygiene = async () => [await prisma.temperatureReading.count(), await prisma.cleaningLog.count(), await prisma.traceRecord.count()];
    const hygieneBefore = await hygiene();

    const before = await totals();
    await refreshDemo(db, { historyDays: 3 });
    expect(await totals()).toEqual(before);
    expect(await hygiene()).toEqual(hygieneBefore);
  });

  it("garde les commandes des visiteurs et nettoie celles restées ouvertes au changement de jour", async () => {
    const visitor = await createOrder(T.actor, { type: "COUNTER", customerName: "Visiteur" });
    await addItem(T.actor, visitor.id, { productId: T.eau.id });
    await refreshDemo(db, { historyDays: 3 });
    expect(await prisma.order.findUnique({ where: { id: visitor.id } })).not.toBeNull();

    // Le lendemain : la journée d'hier est clôturée, ses commandes restées ouvertes disparaissent
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + 86400000));
    const r = await refreshDemo(db, { historyDays: 3 });
    expect(r?.generated).toBe(0);
    const todayStart = startOfLocalDay(localDay(new Date(), TZ), TZ);
    expect(await prisma.order.count({ where: { establishmentId: T.est.id, status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] }, openedAt: { lt: todayStart } } })).toBe(0);
    expect(await prisma.order.findUnique({ where: { id: visitor.id } })).toBeNull();
    expect(await openSessions()).toBe(1);
    expect(await prisma.cashSession.count({ where: { establishmentId: T.est.id, status: "CLOSED" } })).toBe(4);
    vi.useRealTimers();
  });

  it("juste après minuit (heure du restaurant), le CA du jour n'est jamais vide : 6 vraies ventes datées d'aujourd'hui", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Après-demain à 0 h 10 heure de Tahiti (UTC-10) ; puis à 3 h 30, heure à laquelle un test avait échoué en CI
    for (const hhmm of ["10:10", "13:30"]) {
      const day = localDay(new Date(Date.now() + 2 * 86400000), TZ);
      vi.setSystemTime(new Date(`${day}T${hhmm}:00Z`));
      await refreshDemo(db, { historyDays: 3 });
      const todayStart = startOfLocalDay(localDay(new Date(), TZ), TZ);
      expect(await prisma.order.count({ where: { establishmentId: T.est.id, status: "PAID", closedAt: { gte: todayStart } } })).toBeGreaterThanOrEqual(6);
    }
    vi.useRealTimers();
  });
});
