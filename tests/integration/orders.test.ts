import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, applyDiscount, cancelOrder, createOrder, getOrder, removeItem, requestBill, sendCourse, transferTable, updateItem } from "@/server/services/orders";
import { addPayments, refundPayment } from "@/server/services/payments";
import { closeSession, findOpenSession, getSessionReport, openSession, addMovement } from "@/server/services/cash";
import { getFloorStatus } from "@/server/services/floor";
import { getDailySummary } from "@/server/services/reports";
import { localDay } from "@/lib/dates";
import { ApiError } from "@/server/errors";

let T: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("orders");
});

describe("parcours complet : table → articles → cuisine → addition → paiement → clôture", () => {
  it("ouvre une table et interdit une seconde commande ouverte sur la même table", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 4 });
    expect(o.number).toMatch(/^\d{8}-0001$/);
    expect(o.courses.map((c) => c.name)).toEqual(["APÉRITIFS", "ENTRÉES", "PLATS", "DESSERTS"]);
    const again = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 2 });
    expect(again.id).toBe(o.id);
  });

  it("ajoute des articles avec options, affectation par client et calcul TTC/TVA", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id });
    const saignant = T.cuisson.modifiers.find((m) => m.name === "Saignant")!;
    const bacon = T.supp.modifiers.find((m) => m.name === "Bacon")!;
    let r = await addItem(T.actor, o.id, { productId: T.burger.id, quantity: 2, modifiers: [{ modifierId: saignant.id }, { modifierId: bacon.id }], seatNumber: 1, courseId: o.courses[2].id });
    const line = r.items[0];
    expect(line.unitPrice).toBe(2100);
    expect(line.modifiersTotal).toBe(250);
    expect(line.lineTotal).toBe(4700);
    expect(line.taxRateBps).toBe(1300);
    expect(line.seatNumber).toBe(1);
    r = await addItem(T.actor, o.id, { productId: T.biere.id, seatNumber: 2, courseId: o.courses[0].id });
    r = await addItem(T.actor, o.id, { productId: T.eau.id, courseId: o.courses[0].id });
    expect(r.subtotal).toBe(5600);
    expect(r.total).toBe(5600);
    expect(r.taxTotal).toBeGreaterThan(0);
    expect(r.items.length).toBe(3);
  });

  it("refuse une option obligatoire manquante et un produit indisponible", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id });
    await expect(addItem(T.actor, o.id, { productId: T.burger.id })).rejects.toMatchObject({ code: "MODIFIER_REQUIRED" });
    await prisma.product.update({ where: { id: T.eau.id }, data: { isAvailable: false } });
    await expect(addItem(T.actor, o.id, { productId: T.eau.id })).rejects.toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
    await prisma.product.update({ where: { id: T.eau.id }, data: { isAvailable: true } });
  });

  it("ajoute une formule avec supplément (3 500 + 500 = 4 000)", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id });
    const before = o.total;
    const [sEntree, sPlat] = T.menu.sections;
    const r = await addItem(T.actor, o.id, { menuId: T.menu.id, menuSelections: [{ sectionId: sEntree.id, productId: T.entree.id }, { sectionId: sPlat.id, productId: T.burger.id, modifiers: [{ modifierId: T.cuisson.modifiers[0].id }] }] });
    expect(r.total - before).toBe(4000);
    const parent = r.items.find((i) => i.menuId)!;
    expect(r.items.filter((i) => i.parentItemId === parent.id).length).toBe(2);
  });

  it("envoie un service en cuisine : tickets par poste, statuts, plan de salle", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id });
    const apero = o.courses[0];
    const r = await sendCourse(T.actor, o.id, { courseId: apero.id });
    expect(r.status).toBe("SENT");
    expect(r.items.filter((i) => i.courseId === apero.id).every((i) => i.status === "SENT")).toBe(true);
    expect(r.items.filter((i) => i.courseId === o.courses[2].id && !i.parentItemId && !i.menuId).some((i) => i.status === "PENDING")).toBe(true);
    const tickets = await prisma.kitchenTicket.findMany({ where: { orderId: o.id } });
    expect(tickets.length).toBeGreaterThan(0);
    const floor = await getFloorStatus(T.est.id);
    const t1 = floor.rooms[0].tables.find((t) => t.id === T.t1.id)!;
    expect(t1.status).toBe("SENT");
    await expect(sendCourse(T.actor, o.id, { courseId: apero.id })).rejects.toMatchObject({ code: "NOTHING_TO_SEND" });
  });

  it("modifie la quantité d'un article non envoyé, refuse sur un article envoyé, trace la suppression", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id });
    const pending = o.items.find((i) => i.status === "PENDING" && !i.parentItemId && !i.menuId)!;
    const sent = o.items.find((i) => i.status === "SENT")!;
    const r = await updateItem(T.actor, o.id, pending.id, { quantity: 3 });
    expect(r.items.find((i) => i.id === pending.id)!.quantity).toBe(3);
    await expect(updateItem(T.actor, o.id, sent.id, { quantity: 2 })).rejects.toMatchObject({ code: "ITEM_SENT" });
    const r2 = await removeItem({ ...T.actor, authorizedById: T.manager.id }, o.id, sent.id, "erreur");
    expect(r2.items.find((i) => i.id === sent.id)!.status).toBe("VOIDED");
    const log = await prisma.auditLog.findFirst({ where: { action: "item.void", entityId: sent.id } });
    expect(log?.reason).toBe("erreur");
    expect(log?.authorizedById).toBe(T.manager.id);
    await updateItem(T.actor, o.id, pending.id, { quantity: 1 });
  });

  it("applique une remise tracée puis demande l'addition", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id });
    const r = await applyDiscount(T.managerActor, o.id, { percentBps: 1000, reason: "Fidélité" });
    expect(r.discountTotal).toBe(Math.round(r.subtotal / 10));
    expect(r.total).toBe(r.subtotal - r.discountTotal);
    const b = await requestBill(T.actor, o.id);
    expect(b.status).toBe("BILL_REQUESTED");
    expect((await getFloorStatus(T.est.id)).rooms[0].tables.find((t) => t.id === T.t1.id)!.status).toBe("BILL");
  });

  it("refuse les espèces sans session de caisse, puis encaisse en plusieurs moyens et clôture", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id });
    await expect(addPayments(T.actor, o.id, [{ method: "CASH", amount: 1000 }])).rejects.toMatchObject({ code: "NO_CASH_SESSION" });
    await openSession(T.managerActor, { openingFloat: 30000 });
    await expect(addPayments(T.actor, o.id, [{ method: "CARD", amount: o.total + 1 }])).rejects.toMatchObject({ code: "OVERPAYMENT" });
    const part = Math.floor(o.total / 2);
    let r = await addPayments(T.actor, o.id, [{ method: "CASH", amount: part, tendered: part + 500, splitLabel: "Part 1/2" }]);
    expect(r.order.status).toBe("BILL_REQUESTED");
    expect(r.order.paidTotal).toBe(part);
    expect(r.payments[0].changeGiven).toBe(500);
    r = await addPayments(T.actor, o.id, [{ method: "CARD", amount: o.total - part, tipAmount: 200, splitLabel: "Part 2/2" }]);
    expect(r.order.status).toBe("PAID");
    expect(r.order.paidTotal).toBe(o.total);
    expect(r.order.tipTotal).toBe(200);
    expect(r.order.closedAt).not.toBeNull();
    const floor = await getFloorStatus(T.est.id);
    expect(floor.rooms[0].tables.find((t) => t.id === T.t1.id)!.status).toBe("FREE");
    await expect(addItem(T.actor, o.id, { productId: T.eau.id })).rejects.toMatchObject({ code: "ORDER_CLOSED" });
  });

  it("rembourse partiellement (tracé) et impacte la caisse", async () => {
    const order = await prisma.order.findFirst({ where: { establishmentId: T.est.id, status: "PAID" }, include: { payments: true } });
    const cash = order!.payments.find((p) => p.method === "CASH")!;
    const r = await refundPayment(T.managerActor, cash.id, { amount: 300, reason: "Plat froid" });
    expect(r.payments.find((p) => p.id === cash.id)!.refundedAmount).toBe(300);
    expect(r.paidTotal).toBe(order!.total - 300);
    await expect(refundPayment(T.managerActor, cash.id, { amount: 999999, reason: "x" })).rejects.toMatchObject({ code: "BAD_AMOUNT" });
    const session = await findOpenSession(T.est.id, null);
    const rep = await getSessionReport(T.est.id, session!.id);
    expect(rep.summary.cashRefunds).toBe(-300);
  });

  it("clôture de caisse : espèces théoriques, comptées, écart, corrections tracées", async () => {
    const session = (await findOpenSession(T.est.id, null))!;
    await addMovement(T.managerActor, session.id, { kind: "PAY_OUT", amount: 2000, reason: "Achat pain" });
    const rep = await getSessionReport(T.est.id, session.id);
    const expected = 30000 + rep.summary.cashSales + rep.summary.cashRefunds - 2000;
    expect(rep.summary.cashExpected).toBe(expected);
    const closed = await closeSession(T.managerActor, session.id, { countedCash: expected - 100 });
    expect(closed.session.status).toBe("CLOSED");
    expect(closed.summary.difference).toBe(-100);
    await expect(closeSession(T.managerActor, session.id, { countedCash: 1 })).rejects.toMatchObject({ code: "SESSION_CLOSED" });
    const corrected = await addMovement(T.managerActor, session.id, { kind: "CORRECTION", amount: -100, reason: "Erreur de comptage" });
    expect(corrected.summary.difference).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "cash.closing_correction" } })).toBe(1);
  });

  it("annulation d'une commande non payée (tracée), interdit si payée", async () => {
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.eau.id });
    const c = await cancelOrder(T.managerActor, o.id, "Client parti");
    expect(c.status).toBe("CANCELLED");
    const paid = await prisma.order.findFirst({ where: { establishmentId: T.est.id, status: "PAID" } });
    await expect(cancelOrder(T.managerActor, paid!.id, "x")).rejects.toMatchObject({ code: "ORDER_CLOSED" });
  });

  it("transfert de table", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 2 });
    const r = await transferTable(T.actor, o.id, T.t2.id);
    expect(r.tableId).toBe(T.t2.id);
    const o2 = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 1 });
    await expect(transferTable(T.actor, o2.id, T.t2.id)).rejects.toMatchObject({ code: "TABLE_BUSY" });
  });

  it("rapport du jour : CA, tickets, couverts, ventilation", async () => {
    const s = await getDailySummary(T.est.id, localDay(new Date(), T.est.timezone), T.est.timezone);
    expect(s.tickets).toBe(1);
    expect(s.revenue).toBeGreaterThan(0);
    expect(s.revenueHt + s.tax).toBe(s.revenue);
    expect(s.byMethod.map((m) => m.method).sort()).toEqual(["CARD", "CASH"]);
    expect(s.cancellations).toBe(1);
    expect(s.foodCostPct).not.toBeNull();
  });

  it("rejeu idempotent : même id de commande / d'article → pas de doublon", async () => {
    const id = crypto.randomUUID();
    const a = await createOrder(T.actor, { id, type: "TAKEAWAY" });
    const b = await createOrder(T.actor, { id, type: "TAKEAWAY" });
    expect(a.id).toBe(b.id);
    const itemId = crypto.randomUUID();
    await addItem(T.actor, a.id, { id: itemId, productId: T.eau.id });
    const r = await addItem(T.actor, a.id, { id: itemId, productId: T.eau.id });
    expect(r.items.length).toBe(1);
  });

  it("getOrder lève 404 pour une commande d'un autre établissement", async () => {
    const other = await makeTenant("orders-other");
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await expect(getOrder(other.est.id, o.id)).rejects.toBeInstanceOf(ApiError);
    await expect(addItem(other.actor, o.id, { productId: T.eau.id })).rejects.toMatchObject({ status: 404 });
  });
});

describe("mode hors ligne : services pré-générés par le client", () => {
  it("crée la commande avec les ids de services fournis, puis accepte les articles sur ces services", async () => {
    const id = crypto.randomUUID();
    const courses = [{ id: crypto.randomUUID(), name: "ENTRÉES" }, { id: crypto.randomUUID(), name: "PLATS" }];
    const openedAt = new Date(Date.now() - 600000).toISOString();
    const o = await createOrder(T.actor, { id, type: "COUNTER", covers: 2, courses, openedAt });
    expect(o.courses.map((c) => c.id)).toEqual(courses.map((c) => c.id));
    expect(o.openedAt.toISOString()).toBe(openedAt);
    const itemId = crypto.randomUUID();
    const r = await addItem(T.actor, id, { id: itemId, productId: T.eau.id, courseId: courses[1].id });
    expect(r.items[0].id).toBe(itemId);
    expect(r.items[0].courseId).toBe(courses[1].id);
    // rejeu complet (création + article) : aucun doublon
    await createOrder(T.actor, { id, type: "COUNTER", covers: 2, courses, openedAt });
    const r2 = await addItem(T.actor, id, { id: itemId, productId: T.eau.id, courseId: courses[1].id });
    expect(r2.items.length).toBe(1);
  });
});
