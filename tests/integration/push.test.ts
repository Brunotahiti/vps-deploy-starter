import { beforeAll, describe, expect, it, vi } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, createOrder, sendCourse } from "@/server/services/orders";
import { setItemReady, setTicketStatus } from "@/server/services/kitchen";
import { isPushConfigured, notifyDishReady, sentPushes, setPushTransport, subscribePush, unsubscribePush } from "@/server/push";

let T: Awaited<ReturnType<typeof makeTenant>>;
const sub = (n: string) => ({ endpoint: `https://push.example.pf/${n}`, keys: { p256dh: "p256dh-" + n, auth: "auth-" + n } });
const waitFor = (fn: () => boolean) => vi.waitFor(() => { if (!fn()) throw new Error("pas encore"); }, { timeout: 3000, interval: 25 });

beforeAll(async () => {
  process.env.PUSH_TRANSPORT = "memory";
  await resetDb();
  T = await makeTenant("push");
});
const cuisson = () => [{ modifierId: T.cuisson.modifiers.find((m) => m.name === "Saignant")!.id }];

describe("Notifications push « plat prêt »", () => {
  it("configuration : activée par le transport mémoire ; abonnement par appareil au nom de la personne connectée", async () => {
    expect(isPushConfigured()).toBe(true);
    await subscribePush(T.actor, sub("tel-serveur"), "Safari iPhone");
    await subscribePush(T.managerActor, sub("tablette-manager"));
    // Le même appareil réabonné par une autre personne change de propriétaire (un seul abonnement par endpoint)
    await subscribePush(T.managerActor, sub("tel-serveur"));
    expect(await prisma.pushSubscription.count()).toBe(2);
    expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: sub("tel-serveur").endpoint } })).userId).toBe(T.manager.id);
    await subscribePush(T.actor, sub("tel-serveur"), "Safari iPhone");
    expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: sub("tel-serveur").endpoint } })).userId).toBe(T.server.id);
    await expect(subscribePush(T.actor, { endpoint: "http://pas-https/x", keys: { p256dh: "a", auth: "b" } })).rejects.toMatchObject({ code: "BAD_ENDPOINT" });
  });

  it("ticket PRÊT : le serveur de la table est prévenu, pas la cuisine qui a fait le geste", async () => {
    sentPushes.length = 0;
    const kitchenActor = { ...T.managerActor }; // le manager joue la cuisine : abonné, il ne doit pas recevoir son propre geste
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 2 });
    await addItem(T.actor, o.id, { productId: T.burger.id, quantity: 2, courseId: o.courses[2].id, modifiers: cuisson() });
    await addItem(T.actor, o.id, { productId: T.entree.id, courseId: o.courses[2].id });
    await sendCourse(T.actor, o.id, { all: true });
    const ticket = await prisma.kitchenTicket.findFirstOrThrow({ where: { orderId: o.id } });
    await setTicketStatus(kitchenActor, ticket.id, "IN_PROGRESS");
    expect(sentPushes.length).toBe(0);
    await setTicketStatus(kitchenActor, ticket.id, "READY");
    await waitFor(() => sentPushes.length === 1);
    const [p] = sentPushes;
    expect(p.endpoint).toBe(sub("tel-serveur").endpoint);
    expect(p.payload.title).toBe("Plats prêts · Table T01");
    expect(p.payload.body).toContain("2 × Burger");
    expect(p.payload.body).toContain("Salade");
    expect(p.payload.body).toContain("plats");
    expect(p.payload.url).toBe(`/pos/order/${o.id}`);
    expect(p.payload.tag).toBe(`ready-${o.id}`);
    // TERMINÉ après PRÊT : pas de seconde notification
    await setTicketStatus(kitchenActor, ticket.id, "DONE");
    await new Promise((r) => setTimeout(r, 100));
    expect(sentPushes.length).toBe(1);
  });

  it("commande sans serveur abonné (comptoir) : toute l'équipe abonnée est prévenue ; PRÊT via le dernier article coché", async () => {
    sentPushes.length = 0;
    const cuisine = await prisma.user.create({ data: { organizationId: T.org.id, email: "cuisine-push@test.pf", passwordHash: "x", firstName: "Chef", lastName: "Push" } });
    const kitchenActor = { organizationId: T.org.id, establishmentId: T.est.id, userId: cuisine.id };
    const o = await createOrder(T.managerActor, { type: "COUNTER", customerName: "Teva" });
    await addItem(T.managerActor, o.id, { productId: T.burger.id, modifiers: cuisson() });
    await addItem(T.managerActor, o.id, { productId: T.eau.id });
    await sendCourse(T.managerActor, o.id, { all: true });
    // Le manager n'a plus d'abonnement : la commande n'a donc pas de serveur abonné → l'équipe (le serveur) reçoit l'alerte
    await unsubscribePush(T.managerActor, sub("tablette-manager").endpoint);
    const ticket = await prisma.kitchenTicket.findFirstOrThrow({ where: { orderId: o.id }, include: { items: true } });
    await setItemReady(kitchenActor, ticket.id, ticket.items[0].id, true);
    expect(sentPushes.length).toBe(0); // un article sur deux : le ticket n'est pas prêt
    await setItemReady(kitchenActor, ticket.id, ticket.items[1].id, true);
    await waitFor(() => sentPushes.length === 1);
    expect(sentPushes[0].endpoint).toBe(sub("tel-serveur").endpoint);
    expect(sentPushes[0].payload.title).toMatch(/^Plats prêts · Sur place n° \d+ · Teva$/);
    expect(sentPushes[0].payload.body).toContain("à apporter au client");
    expect(sentPushes[0].payload.url).toBe("/pos/emporter"); // la file des commandes, avec « Remise au client »
  });

  it("abonnement expiré (410) retiré ; autre erreur comptée puis retirée après 10 échecs", async () => {
    await subscribePush(T.managerActor, sub("vieux-tel"));
    await subscribePush(T.managerActor, sub("tel-capricieux"));
    setPushTransport(async (s) => (s.endpoint.endsWith("vieux-tel") ? { ok: false, gone: true, error: "HTTP 410" } : s.endpoint.endsWith("tel-capricieux") ? { ok: false, gone: false, error: "HTTP 500" } : { ok: true }));
    try {
      const ticketOrder = await createOrder(T.managerActor, { type: "COUNTER" });
      await addItem(T.managerActor, ticketOrder.id, { productId: T.burger.id, modifiers: cuisson() });
      const r = await notifyDishReady({ organizationId: T.org.id, establishmentId: T.est.id, userId: T.server.id }, { orderId: ticketOrder.id, items: [{ name: "Burger", quantity: 1, status: "READY" }], order: { number: "20261017-0001", type: "COUNTER", serverId: T.manager.id, customerName: null, table: null } });
      expect(r.sent).toBe(0);
      expect(await prisma.pushSubscription.findUnique({ where: { endpoint: sub("vieux-tel").endpoint } })).toBeNull();
      expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: sub("tel-capricieux").endpoint } })).failures).toBe(1);
      await prisma.pushSubscription.update({ where: { endpoint: sub("tel-capricieux").endpoint }, data: { failures: 9 } });
      await notifyDishReady({ organizationId: T.org.id, establishmentId: T.est.id, userId: T.server.id }, { orderId: ticketOrder.id, items: [{ name: "Burger", quantity: 1, status: "READY" }], order: { number: "20261017-0001", type: "COUNTER", serverId: T.manager.id, customerName: null, table: null } });
      expect(await prisma.pushSubscription.findUnique({ where: { endpoint: sub("tel-capricieux").endpoint } })).toBeNull();
    } finally { setPushTransport(null); }
  });
});
