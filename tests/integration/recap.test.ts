import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, applyDiscount, cancelOrder, createOrder, sendCourse } from "@/server/services/orders";
import { addPayments, refundPayment } from "@/server/services/payments";
import { closeSession, openSession } from "@/server/services/cash";
import { setTicketStatus } from "@/server/services/kitchen";
import { getServiceRecap, renderRecapDoc, renderRecapHtml } from "@/server/services/recap";
import { encodeText } from "@/lib/escpos";
import { localDay } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;
const cuisson = () => [{ modifierId: T.cuisson.modifiers.find((m) => m.name === "Saignant")!.id }];

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("recap");
});

describe("Récapitulatif de fin de service", () => {
  it("une journée complète : couverts, CA, marge, remises, remboursements, annulations, caisses, serveurs, produits, cuisine", async () => {
    const day = localDay(new Date(), "Pacific/Tahiti");
    await openSession(T.managerActor, { openingFloat: 10000 });
    // Table de 3 : 2 burgers + 1 salade, service cuisine, payée en espèces
    const a = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 3 });
    await addItem(T.actor, a.id, { productId: T.burger.id, quantity: 2, courseId: a.courses[2].id, modifiers: cuisson() });
    await addItem(T.actor, a.id, { productId: T.entree.id, courseId: a.courses[1].id });
    await sendCourse(T.actor, a.id, { all: true });
    for (const t of await prisma.kitchenTicket.findMany({ where: { orderId: a.id } })) await setTicketStatus(T.managerActor, t.id, "READY");
    const aTotal = (await prisma.order.findUniqueOrThrow({ where: { id: a.id } })).total;
    await addPayments(T.actor, a.id, [{ method: "CASH", amount: aTotal, tendered: aTotal }]);
    // Comptoir du manager : 2 bières avec remise 10 %, payé par carte, puis 100 F remboursés
    const b = await createOrder(T.managerActor, { type: "COUNTER" });
    await addItem(T.managerActor, b.id, { productId: T.biere.id, quantity: 2 });
    await applyDiscount(T.managerActor, b.id, { percentBps: 1000, reason: "Fidélité" });
    const bTotal = (await prisma.order.findUniqueOrThrow({ where: { id: b.id } })).total;
    const { payments } = await addPayments(T.managerActor, b.id, [{ method: "CARD", amount: bTotal }]);
    await refundPayment(T.managerActor, payments[0].id, { amount: 100, reason: "Geste commercial" });
    // Une commande annulée, une encore ouverte
    const c = await createOrder(T.actor, { type: "TAKEAWAY" });
    await addItem(T.actor, c.id, { productId: T.eau.id });
    await cancelOrder(T.managerActor, c.id, "Client parti");
    const d = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t2.id, covers: 2 });
    await addItem(T.actor, d.id, { productId: T.eau.id });
    // Caisse clôturée avec 500 F d'écart
    const session = (await prisma.cashSession.findFirstOrThrow({ where: { establishmentId: T.est.id, status: "OPEN" } }));
    await closeSession(T.managerActor, session.id, { countedCash: 10000 + aTotal - 500 });

    const r = await getServiceRecap(T.est.id, day, { withMargin: true, withStaff: true });
    expect(r.summary.covers).toBe(4); // 3 à table + 1 au comptoir
    expect(r.summary.tickets).toBe(2);
    expect(r.summary.revenue).toBe(aTotal + bTotal);
    expect(r.summary.discounts).toBe(1200 - bTotal); // 10 % sur 2 bières à 600
    expect(r.refunds).toBe(100);
    expect(r.netRevenue).toBe(aTotal + bTotal - 100);
    expect(r.summary.cancellations).toBe(1);
    expect(r.service.openOrders).toBe(1);
    expect(r.margin).not.toBeNull();
    expect(r.margin!.foodCost).toBe(2 * 630 + 300 + 2 * 210);
    expect(r.margin!.gross).toBe(r.summary.revenueHt - r.margin!.foodCost);
    expect(r.margin!.pct).toBeGreaterThan(50);
    expect(r.byType.map((t) => t.label).sort()).toEqual(["Comptoir", "Sur place"]);
    expect(r.summary.byMethod.map((m) => m.method).sort()).toEqual(["CARD", "CASH"]);
    expect(r.summary.byMethod.find((m) => m.method === "CARD")!.amount).toBe(bTotal - 100);
    expect(r.cash.length).toBe(1);
    expect(r.cash[0]).toMatchObject({ status: "CLOSED", openingFloat: 10000, cashSales: aTotal, expectedCash: 10000 + aTotal, countedCash: 10000 + aTotal - 500, difference: -500 });
    expect(r.summary.byServer.length).toBe(2);
    expect(r.summary.byProduct[0].name).toBe("Burger");
    expect(r.summary.byProduct.find((p) => p.name === "Bière")!.quantity).toBe(2);
    expect(r.kitchen.tickets).toBe(2);
    expect(r.kitchen.avgPrepSec).not.toBeNull();
    expect(r.peakHour).not.toBeNull();
    expect(r.staff).not.toBeNull(); // option Équipe du jeu de test : 0 h, mais le bloc existe
    expect(r.service.firstOrderAt).not.toBeNull();

    // Sans le droit Rapports : pas de marge ni de personnel
    const light = await getServiceRecap(T.est.id, day, { withMargin: false, withStaff: false });
    expect(light.margin).toBeNull();
    expect(light.staff).toBeNull();
    expect(light.summary.covers).toBe(4);

    // Ticket thermique : lisible, en ASCII, avec les grands chiffres
    const text = encodeText(renderRecapDoc(r, 42));
    expect(text).toContain("FIN DE SERVICE");
    expect(text).toContain("COUVERTS");
    expect(text).toMatch(/COUVERTS\s+4/);
    expect(text).toContain("MARGE BRUTE HT");
    expect(text).toContain("Ecart");
    expect(text).toContain("Burger");
    expect(text).not.toMatch(/[éèàç]/);
    expect(encodeText(renderRecapDoc(light, 32))).not.toContain("MARGE");

    // Page imprimable : les mêmes chiffres, sans injection possible (nom d'établissement échappé)
    await prisma.establishment.update({ where: { id: T.est.id }, data: { name: "Chez <b>Teva</b>" } });
    const html = renderRecapHtml(await getServiceRecap(T.est.id, day, { withMargin: true, withStaff: false }));
    expect(html).toContain("Chez &lt;b&gt;Teva&lt;/b&gt;");
    expect(html).not.toContain("<b>Teva</b>");
    expect(html).toContain("Marge brute HT");
    expect(html).toContain("Récapitulatif de fin de service");
  });

  it("journée vide : aucun chiffre, pas d'erreur", async () => {
    const r = await getServiceRecap(T.est.id, "2020-01-01", { withMargin: true, withStaff: false });
    expect(r.summary.revenue).toBe(0);
    expect(r.summary.covers).toBe(0);
    expect(r.cash).toEqual([]);
    expect(r.peakHour).toBeNull();
    expect(r.margin!.pct).toBeNull();
    expect(encodeText(renderRecapDoc(r))).toContain("COUVERTS");
    expect(renderRecapHtml(r)).toContain("Aucune vente encaissée ce jour");
  });
});
