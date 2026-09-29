import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { acceptOnlineOrder, callWaiter, clearCall, createKioskOrder, createOnlineOrder, digitalSettings, listOnlineOrders, orderFromTable, rejectOnlineOrder, tableMenu, tableQrList, trackOrder } from "@/server/services/public";
import { attachCustomer, getCustomerCard, listCustomers, redeemReward, upsertCustomer } from "@/server/services/customers";
import { createPublicReservation, listReservations, setReservationStatus, upsertReservation } from "@/server/services/reservations";
import { addItem, createOrder, getOrder, sendCourse } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { getFloorStatus, upsertTable } from "@/server/services/floor";
import { localDay } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;
const TZ = "Pacific/Tahiti";

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("digital");
  await prisma.establishment.update({ where: { id: T.est.id }, data: { settings: { digital: { qrMode: "ORDER", online: { enabled: true, pickup: true, delivery: true, pickupLeadMin: 15, deliveryFee: 500, deliveryMinOrder: 1000, deliveryZones: ["Punaauia"], message: "" }, kiosk: { enabled: true, dineIn: true, takeaway: true } }, loyalty: { enabled: true, pointsPer100: 1, rewardPoints: 10, rewardValue: 500 } } } });
});

describe("Phase 6 — QR à table", () => {
  it("menu public par QR, sans coûts ni stocks ; appel serveur visible sur le plan de salle", async () => {
    const m = await tableMenu(T.t1.qrToken);
    expect(m.table.name).toBe("T01");
    expect(m.mode).toBe("ORDER");
    expect(m.catalog.products.length).toBeGreaterThan(0);
    expect((m.catalog.products[0] as unknown as { costPrice?: number }).costPrice).toBeUndefined();
    await callWaiter(T.t1.qrToken, "Addition");
    const floor = await getFloorStatus(T.est.id);
    expect(floor.rooms[0].tables.find((t) => t.id === T.t1.id)!.callRequestedAt).not.toBeNull();
    await clearCall(T.actor, T.t1.id);
    expect((await prisma.table.findUniqueOrThrow({ where: { id: T.t1.id } })).callRequestedAt).toBeNull();
    const s = await digitalSettings(T.est.id);
    expect(s.online.deliveryZones).toEqual(["Punaauia"]);
    const qr = await tableQrList(T.est.id, "https://resto.pf");
    expect(qr[0].url).toBe(`https://resto.pf/m/${qr[0].qrToken}`);
  });

  it("commande depuis la table en mode validation : ouverte, articles en attente, visible côté salle ; mode direct → envoyée", async () => {
    const o = await orderFromTable(T.t1.qrToken, { id: crypto.randomUUID(), lines: [{ id: crypto.randomUUID(), productId: T.eau.id, quantity: 2 }], covers: 3 });
    expect(o.tableId).toBe(T.t1.id);
    expect(o.covers).toBe(3);
    expect(o.items[0].status).toBe("PENDING");
    expect((o.channelMeta as { awaitingValidation: boolean }).awaitingValidation).toBe(true);
    // Le serveur valide en envoyant
    await sendCourse(T.actor, o.id, { all: true });
    const menu = await tableMenu(T.t1.qrToken);
    expect(menu.order!.items[0].status).toBe("SENT");
    // Mode direct
    await prisma.establishment.update({ where: { id: T.est.id }, data: { settings: { digital: { qrMode: "ORDER_DIRECT", online: { enabled: true, pickup: true, delivery: true, pickupLeadMin: 15, deliveryFee: 500, deliveryMinOrder: 1000, deliveryZones: ["Punaauia"] }, kiosk: { enabled: true } }, loyalty: { enabled: true, pointsPer100: 1, rewardPoints: 10, rewardValue: 500 } } } });
    const o2 = await orderFromTable(T.t2.qrToken, { id: crypto.randomUUID(), lines: [{ id: crypto.randomUUID(), productId: T.eau.id, quantity: 1 }] });
    expect(o2.items[0].status).toBe("SENT");
    expect(await prisma.kitchenTicket.count({ where: { orderId: o2.id } })).toBe(1);
    await prisma.establishment.update({ where: { id: T.est.id }, data: { settings: { digital: { qrMode: "MENU" }, loyalty: { enabled: true, pointsPer100: 1, rewardPoints: 10, rewardValue: 500 } } } });
    await expect(callWaiter(T.t2.qrToken)).rejects.toMatchObject({ code: "MODE_OFF" });
  });
});

describe("Phase 6 — commande en ligne, suivi, borne", () => {
  it("click & collect : client créé, commande en attente d'acceptation, suivi public, acceptation → cuisine", async () => {
    await prisma.establishment.update({ where: { id: T.est.id }, data: { settings: { digital: { qrMode: "ORDER", online: { enabled: true, pickup: true, delivery: true, pickupLeadMin: 15, deliveryFee: 500, deliveryMinOrder: 1000, deliveryZones: ["Punaauia"] }, kiosk: { enabled: true, dineIn: true, takeaway: true } }, loyalty: { enabled: true, pointsPer100: 1, rewardPoints: 10, rewardValue: 500 } } } });
    const t = await createOnlineOrder(T.org.slug, T.est.slug, { id: crypto.randomUUID(), mode: "PICKUP", name: "Hina Tetuanui", phone: "+689 87 44 55 66", when: "12:30", lines: [{ id: crypto.randomUUID(), productId: T.eau.id, quantity: 3 }] });
    expect(t.stage).toBe("RECEIVED");
    expect(t.type).toBe("ONLINE");
    expect(t.totalWithFee).toBe(900);
    const customers = await listCustomers(T.org.id, { search: "Hina" });
    expect(customers.length).toBe(1);
    const pending = await listOnlineOrders(T.est.id);
    expect(pending.find((o) => o.id === t.id)!.awaiting).toBe(true);
    const accepted = await acceptOnlineOrder(T.actor, t.id);
    expect(accepted.acceptedAt).not.toBeNull();
    expect(accepted.items[0].status).toBe("SENT");
    const track = await prisma.order.findUniqueOrThrow({ where: { id: t.id } });
    expect((await trackOrder(track.publicToken!)).stage).toBe("ACCEPTED");
    // Rejeu idempotent
    const again = await createOnlineOrder(T.org.slug, T.est.slug, { id: t.id, mode: "PICKUP", name: "Hina", phone: "+689 87 44 55 66", lines: [{ id: crypto.randomUUID(), productId: T.eau.id, quantity: 1 }] });
    expect(again.id).toBe(t.id);
  });

  it("livraison : zone obligatoire, minimum de commande, frais ; refus → annulée avec motif", async () => {
    await expect(createOnlineOrder(T.org.slug, T.est.slug, { id: crypto.randomUUID(), mode: "DELIVERY", name: "Marc", phone: "89123456", address: "PK 12", zone: "Papeete", lines: [{ id: crypto.randomUUID(), productId: T.eau.id, quantity: 1 }] })).rejects.toMatchObject({ code: "OUT_OF_ZONE" });
    await expect(createOnlineOrder(T.org.slug, T.est.slug, { id: crypto.randomUUID(), mode: "DELIVERY", name: "Marc", phone: "89123456", address: "PK 12", zone: "Punaauia", lines: [{ id: crypto.randomUUID(), productId: T.eau.id, quantity: 1 }] })).rejects.toMatchObject({ code: "MIN_ORDER" });
    const t = await createOnlineOrder(T.org.slug, T.est.slug, { id: crypto.randomUUID(), mode: "DELIVERY", name: "Marc Dupont", phone: "89123456", address: "PK 12", zone: "Punaauia", lines: [{ id: crypto.randomUUID(), productId: T.eau.id, quantity: 4 }] });
    expect(t.type).toBe("DELIVERY");
    expect(t.channelMeta.deliveryFee).toBe(500);
    expect(t.totalWithFee).toBe(1200 + 500);
    await rejectOnlineOrder(T.actor, t.id, "Trop loin ce soir");
    const track = await prisma.order.findUniqueOrThrow({ where: { id: t.id } });
    const tr = await trackOrder(track.publicToken!);
    expect(tr.stage).toBe("CANCELLED");
    expect(tr.cancelReason).toBe("Trop loin ce soir");
  });

  it("borne : commande envoyée directement, numéro d'appel, paiement en caisse", async () => {
    const terminal = await prisma.terminal.create({ data: { establishmentId: T.est.id, name: "Borne 1", kind: "KIOSK", deviceKeyHash: "kiosk-test-hash" } });
    const t = await createKioskOrder(T.est.id, terminal.id, { id: crypto.randomUUID(), mode: "TAKEAWAY", name: "Moe", lines: [{ id: crypto.randomUUID(), productId: T.eau.id, quantity: 2 }], lang: "en" });
    expect(t.type).toBe("KIOSK");
    expect(t.stage).toBe("ACCEPTED");
    expect(t.items[0].status).toBe("SENT");
    const o = await getOrder(T.est.id, t.id);
    expect(o.terminalId).toBe(terminal.id);
    expect((o.channelMeta as { payAtCounter: boolean }).payAtCounter).toBe(true);
    await prisma.establishment.update({ where: { id: T.est.id }, data: { settings: { digital: { qrMode: "ORDER", online: { enabled: false }, kiosk: { enabled: false } }, loyalty: { enabled: true, pointsPer100: 1, rewardPoints: 10, rewardValue: 500 } } } });
    await expect(createKioskOrder(T.est.id, terminal.id, { id: crypto.randomUUID(), mode: "DINE_IN", lines: [{ id: crypto.randomUUID(), productId: T.eau.id, quantity: 1 }] })).rejects.toMatchObject({ code: "MODE_OFF" });
    await expect(createOnlineOrder(T.org.slug, T.est.slug, { id: crypto.randomUUID(), mode: "PICKUP", name: "X Y", phone: "89000000", lines: [{ id: crypto.randomUUID(), productId: T.eau.id, quantity: 1 }] })).rejects.toMatchObject({ code: "MODE_OFF" });
  });
});

describe("Phase 6 — fidélité et réservations", () => {
  it("points gagnés au paiement, récompense utilisée en remise", async () => {
    const c = await upsertCustomer(T.managerActor, { firstName: "Teiki", lastName: "Faatau", phone: "87112233" });
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.eau.id, quantity: 5 }); // 1 500 F → 15 points
    await attachCustomer(T.actor, o.id, c.id);
    await sendCourse(T.actor, o.id, { all: true });
    await addPayments(T.actor, o.id, [{ method: "CARD", amount: 1500 }]);
    let card = await getCustomerCard(T.est.id, c.id);
    expect(card.points).toBe(15);
    expect(card.visitCount).toBe(1);
    expect(card.totalSpent).toBe(1500);
    expect(card.rewardsAvailable).toBe(1);
    const o2 = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o2.id, { productId: T.eau.id, quantity: 3 });
    await attachCustomer(T.actor, o2.id, c.id);
    const r = await redeemReward(T.actor, o2.id, 1);
    expect(r.amount).toBe(500);
    const after = await getOrder(T.est.id, o2.id);
    expect(after.discountTotal).toBe(500);
    expect(after.total).toBe(400);
    card = await getCustomerCard(T.est.id, c.id);
    expect(card.points).toBe(5);
    await expect(redeemReward(T.actor, o2.id, 1)).rejects.toMatchObject({ code: "NOT_ENOUGH_POINTS" });
    // Doublon par téléphone : mise à jour, pas de nouveau client
    const dup = await upsertCustomer(T.managerActor, { firstName: "Teiki", phone: "87112233", email: "teiki@mail.pf" });
    expect(dup.id).toBe(c.id);
    expect(dup.email).toBe("teiki@mail.pf");
  });

  it("réservation publique → confirmation → installation ouvre la commande avec les couverts et le client", async () => {
    const day = localDay(new Date(), TZ);
    const startsAt = new Date(Date.now() + 2 * 3600_000).toISOString();
    const pub = await createPublicReservation(T.est.id, T.org.id, { name: "Sophie Martin", phone: "87654321", startsAt, partySize: 4, allergies: "Arachides" });
    expect(pub.status).toBe("PENDING");
    expect(pub.customerId).not.toBeNull();
    let list = await listReservations(T.est.id, day, TZ);
    expect(list.some((r) => r.id === pub.id)).toBe(true);
    const t3 = await upsertTable(T.managerActor, { roomId: T.room.id, name: "T03", seats: 4 });
    await expect(setReservationStatus(T.actor, pub.id, "SEATED", t3.id)).rejects.toMatchObject({ code: "BAD_TRANSITION" });
    await setReservationStatus(T.actor, pub.id, "CONFIRMED", t3.id);
    expect((await prisma.table.findUniqueOrThrow({ where: { id: t3.id } })).state).toBe("RESERVED");
    const seated = await setReservationStatus(T.actor, pub.id, "SEATED");
    expect(seated.orderId).not.toBeNull();
    const order = await getOrder(T.est.id, seated.orderId!);
    expect(order.covers).toBe(4);
    expect(order.customerId).toBe(pub.customerId);
    expect(order.notes).toContain("Arachides");
    expect((await prisma.table.findUniqueOrThrow({ where: { id: t3.id } })).state).toBe("FREE");
    const manual = await upsertReservation(T.managerActor, { name: "Marc", phone: "89123456", startsAt, partySize: 2 });
    expect(manual.status).toBe("CONFIRMED");
    list = await listReservations(T.est.id, day, TZ);
    expect(list.length).toBe(2);
  });
});
