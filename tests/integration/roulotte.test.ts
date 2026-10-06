import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, createOrder, getOrCreateCounterDraft, getOrder, isPayAtOrder, cancelOrder } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { openSession } from "@/server/services/cash";
import { listKitchenTickets, setTicketStatus } from "@/server/services/kitchen";
import { takeawayBoard } from "@/server/services/takeaway";
import { businessTypeSettings } from "@/lib/options";

let T: Awaited<ReturnType<typeof makeTenant>>;
const cuisson = () => [{ modifierId: T.cuisson.modifiers.find((m) => m.name === "Saignant")!.id }];

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("roulotte");
  await prisma.establishment.update({ where: { id: T.est.id }, data: { businessType: "snack", settings: businessTypeSettings("snack") as object } });
  await openSession(T.managerActor, { openingFloat: 10000 });
});

describe("Mode roulotte : encaissement à la commande puis envoi en cuisine", () => {
  it("un snack démarre en mode roulotte ; le réglage se lit dans settings.payAtOrder", async () => {
    expect(isPayAtOrder(businessTypeSettings("snack"))).toBe(true);
    expect(isPayAtOrder(businessTypeSettings("restaurant"))).toBe(false);
    expect(isPayAtOrder({ payAtOrder: false })).toBe(false);
    expect(isPayAtOrder(null)).toBe(false);
  });

  it("encaisser envoie en cuisine : la commande est payée, les articles envoyés (pas « servis »), un bon par poste, stock décrémenté une fois", async () => {
    const stations = await prisma.kitchenStation.findMany({ where: { establishmentId: T.est.id } });
    await prisma.product.update({ where: { id: T.burger.id }, data: { kitchenStationId: stations.find((s) => s.name === "CUISINE")!.id } });
    await prisma.product.update({ where: { id: T.biere.id }, data: { kitchenStationId: stations.find((s) => s.name === "BAR")!.id, trackStock: true, stockQty: 10 } });
    const o = await createOrder(T.actor, { type: "COUNTER", customerName: "Moana" });
    await addItem(T.actor, o.id, { productId: T.burger.id, quantity: 2, modifiers: cuisson() });
    await addItem(T.actor, o.id, { productId: T.biere.id });
    const before = await getOrder(T.est.id, o.id);
    expect(before.items.every((i) => i.status === "PENDING")).toBe(true);
    expect(await prisma.kitchenTicket.count({ where: { orderId: o.id } })).toBe(0);

    const { order } = await addPayments(T.actor, o.id, [{ method: "CASH", amount: before.total, tendered: before.total }]);
    expect(order.status).toBe("PAID");
    expect(order.items.map((i) => i.status)).toEqual(["SENT", "SENT"]);
    expect(order.items.every((i) => i.sentAt && i.kitchenTicketId)).toBe(true);
    expect(order.courses[0].status).toBe("SENT");
    const tickets = await listKitchenTickets(T.est.id);
    expect(tickets.filter((t) => t.orderId === o.id).map((t) => t.station?.name).sort()).toEqual(["BAR", "CUISINE"]);
    expect(tickets.every((t) => t.status === "NEW")).toBe(true);
    // Stock de la bière : décrémenté une seule fois (par l'envoi, pas une seconde fois par la clôture)
    expect((await prisma.product.findUniqueOrThrow({ where: { id: T.biere.id } })).stockQty).toBe(9);
    // La commande suit son cours sur le tableau « À emporter » : en préparation, payée
    const board = await takeawayBoard(T.est.id);
    expect(board.preparing.find((c) => c.id === o.id)).toMatchObject({ paid: true, channel: "COUNTER", itemsSent: 3 });
  });

  it("la cuisine termine : la commande passe « prête » (numéro appelé) puis disparaît une fois remise", async () => {
    const o = (await prisma.order.findFirstOrThrow({ where: { establishmentId: T.est.id, customerName: "Moana" } }));
    const tickets = await prisma.kitchenTicket.findMany({ where: { orderId: o.id } });
    await setTicketStatus(T.managerActor, tickets[0].id, "READY");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).readyAt).toBeNull(); // un poste sur deux
    await setTicketStatus(T.managerActor, tickets[1].id, "READY");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).readyAt).not.toBeNull();
    expect((await takeawayBoard(T.est.id)).ready.map((c) => c.id)).toContain(o.id);
    for (const t of tickets) await setTicketStatus(T.managerActor, t.id, "DONE");
    const after = await getOrder(T.est.id, o.id);
    expect(after.status).toBe("PAID");
    expect(after.items.every((i) => i.status === "SERVED")).toBe(true);
    const board = await takeawayBoard(T.est.id);
    expect([...board.preparing, ...board.ready].map((c) => c.id)).not.toContain(o.id);
  });

  it("brouillon comptoir : la même commande tant qu'elle n'est ni payée ni annulée, par personne et par terminal", async () => {
    const a = await getOrCreateCounterDraft(T.actor);
    expect(a.type).toBe("COUNTER");
    expect(a.items.length).toBe(0);
    await addItem(T.actor, a.id, { productId: T.eau.id });
    const b = await getOrCreateCounterDraft(T.actor);
    expect(b.id).toBe(a.id); // rechargement de la page : on retrouve la commande en cours
    // Une autre personne (ou un autre terminal) a sa propre commande
    const m = await getOrCreateCounterDraft(T.managerActor);
    expect(m.id).not.toBe(a.id);
    const t = await getOrCreateCounterDraft({ ...T.actor, terminalId: (await prisma.terminal.create({ data: { establishmentId: T.est.id, name: "Caisse 2", deviceKeyHash: "k2" } })).id });
    expect(t.id).not.toBe(a.id);
    // Payée : la suivante est une nouvelle commande
    await addPayments(T.actor, a.id, [{ method: "CARD", amount: (await getOrder(T.est.id, a.id)).total }]);
    const c = await getOrCreateCounterDraft(T.actor);
    expect(c.id).not.toBe(a.id);
    expect((await getOrder(T.est.id, a.id)).items[0].status).toBe("SENT");
    // Annulée : idem
    await cancelOrder(T.managerActor, c.id, "Client parti");
    expect((await getOrCreateCounterDraft(T.actor)).id).not.toBe(c.id);
  });

  it("hors mode roulotte, un comptoir payé sans envoi garde le comportement d'origine (articles servis, pas de bon)", async () => {
    await prisma.establishment.update({ where: { id: T.est.id }, data: { settings: { payAtOrder: false } } });
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.eau.id });
    const { order } = await addPayments(T.actor, o.id, [{ method: "CARD", amount: (await getOrder(T.est.id, o.id)).total }]);
    expect(order.items[0].status).toBe("SERVED");
    expect(await prisma.kitchenTicket.count({ where: { orderId: o.id } })).toBe(0);
  });
});
