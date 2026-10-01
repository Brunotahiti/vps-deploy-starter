import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, createOrder } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { closeSession, getSessionReport, openSession } from "@/server/services/cash";

let T: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("offline");
});

/** Commande comptoir avec un article, prête à encaisser. */
async function orderToPay() {
  const o = await createOrder(T.actor, { type: "COUNTER" });
  return addItem(T.actor, o.id, { productId: T.biere.id });
}

describe("coupure d'internet : les espèces encaissées hors ligne ne sont jamais perdues", () => {
  it("sans caisse ouverte, le rejeu est accepté et la vente attend la prochaine session", async () => {
    const o = await orderToPay();
    // Saisie normale : toujours refusée sans caisse ouverte
    await expect(addPayments(T.actor, o.id, [{ method: "CASH", amount: o.total }])).rejects.toMatchObject({ code: "NO_CASH_SESSION" });
    // Rejeu de la file hors ligne : l'argent est déjà dans le tiroir, le paiement est enregistré
    const r = await addPayments(T.actor, o.id, [{ id: crypto.randomUUID(), method: "CASH", amount: o.total, tendered: o.total }], { offlineReplay: true });
    expect(r.order.status).toBe("PAID");
    expect(r.payments[0].cashSessionId).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "payment.offline_unassigned", entityId: r.payments[0].id } })).toBe(1);

    // À l'ouverture de la caisse, la vente rejoint la session avec son mouvement : le comptage reste juste
    const opened = await openSession(T.managerActor, { openingFloat: 10000 });
    const p = await prisma.payment.findUniqueOrThrow({ where: { id: r.payments[0].id } });
    expect(p.cashSessionId).toBe(opened.session.id);
    const report = await getSessionReport(T.est.id, opened.session.id);
    expect(report.summary.cashSales).toBe(o.total);
    expect(report.summary.cashExpected).toBe(10000 + o.total);
    expect(report.session.movements.find((m) => m.kind === "SALE")?.reason).toBe(`Vente hors ligne ${o.number}`);

    // Une seconde ouverture ne la rattache pas deux fois
    await closeSession(T.managerActor, opened.session.id, { countedCash: 10000 + o.total });
    const again = await openSession(T.managerActor, { openingFloat: 5000 });
    expect((await getSessionReport(T.est.id, again.session.id)).summary.cashSales).toBe(0);
    await closeSession(T.managerActor, again.session.id, { countedCash: 5000 });
  });

  it("caisse clôturée pendant la coupure : la vente rejoint la session suivante, pas la session close", async () => {
    const s = await openSession(T.managerActor, { openingFloat: 0 });
    const o = await orderToPay();
    await closeSession(T.managerActor, s.session.id, { countedCash: 0 });
    const r = await addPayments(T.actor, o.id, [{ id: crypto.randomUUID(), method: "CASH", amount: o.total }], { offlineReplay: true });
    expect(r.payments[0].cashSessionId).toBeNull();
    expect((await getSessionReport(T.est.id, s.session.id)).summary.cashSales).toBe(0);
    const next = await openSession(T.managerActor, { openingFloat: 0 });
    expect((await getSessionReport(T.est.id, next.session.id)).summary.cashExpected).toBe(o.total);
  });
});
