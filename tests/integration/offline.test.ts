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

describe("caisse ouverte sans internet : rejeu sans doublon", () => {
  beforeAll(async () => {
    for (const s of await prisma.cashSession.findMany({ where: { establishmentId: T.est.id, status: "OPEN" } })) await closeSession(T.managerActor, s.id, { countedCash: 0 });
  });

  it("l'ouverture rejouée avec le même identifiant renvoie la même session", async () => {
    const id = crypto.randomUUID();
    const a = await openSession(T.managerActor, { id, openingFloat: 15000 }, { offlineReplay: true });
    expect(a.session.id).toBe(id);
    const b = await openSession(T.managerActor, { id, openingFloat: 15000 }, { offlineReplay: true });
    expect(b.session.id).toBe(id);
    expect(await prisma.cashSession.count({ where: { establishmentId: T.est.id, status: "OPEN" } })).toBe(1);
    await closeSession(T.managerActor, id, { countedCash: 15000 });
  });

  it("caisse déjà ouverte sur ce terminal : la tablette la rejoint, le fond saisi hors ligne est tracé", async () => {
    const open = await openSession(T.managerActor, { openingFloat: 20000 });
    const offlineId = crypto.randomUUID();
    const r = await openSession(T.managerActor, { id: offlineId, openingFloat: 12000 }, { offlineReplay: true });
    expect(r.session.id).toBe(open.session.id);
    expect(await prisma.auditLog.count({ where: { action: "cash.open_offline_merged", entityId: open.session.id } })).toBe(1);
    // Saisie normale : toujours refusée
    await expect(openSession(T.managerActor, { openingFloat: 1 })).rejects.toMatchObject({ code: "ALREADY_OPEN" });
    await closeSession(T.managerActor, open.session.id, { countedCash: 20000 });
  });
});
