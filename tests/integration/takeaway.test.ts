import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { sentMails } from "@/server/email/mailer";
import { addItem, createOrder, sendCourse } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { openSession } from "@/server/services/cash";
import { setTicketStatus } from "@/server/services/kitchen";
import { acceptOnlineOrder, createOnlineOrder, trackOrder } from "@/server/services/public";
import { callDisplay, callNumber, setTakeawayStep, takeawayBoard } from "@/server/services/takeaway";

let T: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  process.env.EMAIL_TRANSPORT = "memory";
  await resetDb();
  T = await makeTenant("emporter");
  await prisma.establishment.update({ where: { id: T.est.id }, data: { settings: { digital: { qrMode: "ORDER", online: { enabled: true, pickup: true, delivery: false, pickupLeadMin: 15, deliveryFee: 0, deliveryMinOrder: 0, deliveryZones: [] } } } } });
  await openSession(T.managerActor, { openingFloat: 10000 });
});

const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

describe("Vente à emporter", () => {
  it("numéro d'appel lisible", () => {
    expect(callNumber("20261002-0042")).toBe("42");
    expect(callNumber("20261002-0201")).toBe("201");
  });

  it("file : en préparation → prête quand la cuisine a fini → remise une fois payée", async () => {
    const pickupAt = new Date(Date.now() + 30 * 60000).toISOString();
    const o = await createOrder(T.actor, { type: "TAKEAWAY", customerName: "Hina", customerPhone: "87 00 00 00", pickupAt });
    // Commande vide : pas encore dans la file
    expect(ids((await takeawayBoard(T.est.id)).preparing)).not.toContain(o.id);
    await addItem(T.actor, o.id, { productId: T.entree.id, quantity: 2 });
    let board = await takeawayBoard(T.est.id);
    const card = board.preparing.find((c) => c.id === o.id)!;
    expect(card).toMatchObject({ name: "Hina", phone: "87 00 00 00", channel: "TAKEAWAY", paid: false, items: 2, itemsSent: 0, pickupAt });
    expect((await callDisplay(T.est.id)).preparing).toContain(card.call);

    // Cuisine : ticket prêt → la commande passe prête d'elle-même (heure enregistrée), numéro à l'écran d'appel
    await sendCourse(T.actor, o.id, { all: true });
    const ticket = await prisma.kitchenTicket.findFirstOrThrow({ where: { orderId: o.id } });
    await setTicketStatus(T.actor, ticket.id, "READY");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).readyAt).not.toBeNull();
    board = await takeawayBoard(T.est.id);
    expect(ids(board.ready)).toContain(o.id);
    const display = await callDisplay(T.est.id);
    expect(display.ready.map((r) => r.call)).toContain(card.call);
    expect(JSON.stringify(display)).not.toMatch(/Hina|87 00/); // ni nom ni téléphone à l'écran

    // Remise refusée tant que la commande n'est pas payée
    await expect(setTakeawayStep(T.actor, o.id, "picked_up")).rejects.toMatchObject({ status: 409, code: "NOT_PAID" });
    const fresh = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    await addPayments(T.actor, o.id, [{ method: "CARD", amount: fresh.total }]);
    expect((await takeawayBoard(T.est.id)).ready.find((c) => c.id === o.id)!.paid).toBe(true);
    await setTakeawayStep(T.actor, o.id, "picked_up");
    board = await takeawayBoard(T.est.id);
    expect([...ids(board.preparing), ...ids(board.ready)]).not.toContain(o.id);
  });

  it("prête à la main, puis « pas encore prête » ; les commandes sur place n'y sont pas", async () => {
    const o = await createOrder(T.actor, { type: "COUNTER", customerName: "Moana" });
    await addItem(T.actor, o.id, { productId: T.eau.id });
    await setTakeawayStep(T.actor, o.id, "ready");
    expect(ids((await takeawayBoard(T.est.id)).ready)).toContain(o.id);
    await setTakeawayStep(T.actor, o.id, "not_ready");
    expect(ids((await takeawayBoard(T.est.id)).preparing)).toContain(o.id);

    const table = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t2.id });
    await addItem(T.actor, table.id, { productId: T.eau.id });
    const all = await takeawayBoard(T.est.id);
    expect([...ids(all.preparing), ...ids(all.ready), ...ids(all.toAccept)]).not.toContain(table.id);
    await expect(setTakeawayStep(T.actor, table.id, "ready")).rejects.toMatchObject({ code: "NOT_TAKEAWAY" });
  });

  it("commande en ligne : à accepter, puis prête → client prévenu par e-mail et suivi « prête », puis « remise »", async () => {
    const t = await createOnlineOrder(T.org.slug, T.est.slug, { id: crypto.randomUUID(), mode: "PICKUP", name: "Teva", phone: "+689 87 11 22 33", email: "teva@exemple.pf", when: "12:30", lines: [{ id: crypto.randomUUID(), productId: T.eau.id, quantity: 2 }] });
    let board = await takeawayBoard(T.est.id);
    expect(board.toAccept.find((c) => c.id === t.id)).toMatchObject({ channel: "PICKUP", name: "Teva", when: "12:30" });
    await expect(setTakeawayStep(T.actor, t.id, "ready")).rejects.toMatchObject({ code: "NOT_ACCEPTED" });
    await acceptOnlineOrder(T.actor, t.id);
    board = await takeawayBoard(T.est.id);
    expect(ids(board.preparing)).toContain(t.id);

    const before = sentMails.length;
    await setTakeawayStep(T.actor, t.id, "ready");
    await new Promise((r) => setTimeout(r, 50));
    const mail = sentMails.slice(before).find((m) => m.to === "teva@exemple.pf");
    expect(mail?.subject).toMatch(/prête/);
    const token = (await prisma.order.findUniqueOrThrow({ where: { id: t.id } })).publicToken!;
    expect((await trackOrder(token)).stage).toBe("READY");

    const total = (await prisma.order.findUniqueOrThrow({ where: { id: t.id } })).total;
    await addPayments(T.actor, t.id, [{ method: "CARD", amount: total }]);
    await setTakeawayStep(T.actor, t.id, "picked_up");
    expect((await trackOrder(token)).stage).toBe("DONE");
  });
});

describe("Vente à emporter : commandes déjà remises", () => {
  it("payée et « terminée » en cuisine : remise ; payée et seulement « prête » : reste à remettre", async () => {
    const done = await createOrder(T.actor, { type: "COUNTER" });
    const ready = await createOrder(T.actor, { type: "TAKEAWAY", customerName: "Rava" });
    for (const [o, status] of [[done, "DONE"], [ready, "READY"]] as const) {
      await addItem(T.actor, o.id, { productId: T.eau.id });
      await sendCourse(T.actor, o.id, { all: true });
      const ticket = await prisma.kitchenTicket.findFirstOrThrow({ where: { orderId: o.id } });
      await setTicketStatus(T.actor, ticket.id, status);
      const fresh = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
      await addPayments(T.actor, o.id, [{ method: "CARD", amount: fresh.total }]);
    }
    const board = await takeawayBoard(T.est.id);
    expect([...ids(board.preparing), ...ids(board.ready)]).not.toContain(done.id);
    expect(ids(board.ready)).toContain(ready.id);
  });
});
