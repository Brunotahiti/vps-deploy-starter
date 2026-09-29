import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, cancelOrder, createOrder, getOrder, removeItem, sendCourse } from "@/server/services/orders";
import { kitchenSummary, listKitchenTickets, setItemReady, setTicketStatus } from "@/server/services/kitchen";
import { renderKitchenTicketEscPos, renderKitchenTicketHtml } from "@/server/receipts/kitchen-ticket";
import { getFloorStatus } from "@/server/services/floor";

let T: Awaited<ReturnType<typeof makeTenant>>;
let cuisineId: string, barId: string;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("kitchen");
  const stations = await prisma.kitchenStation.findMany({ where: { establishmentId: T.est.id } });
  cuisineId = stations.find((s) => s.name === "CUISINE")!.id;
  barId = stations.find((s) => s.name === "BAR")!.id;
  await prisma.product.update({ where: { id: T.burger.id }, data: { kitchenStationId: cuisineId } });
  await prisma.product.update({ where: { id: T.entree.id }, data: { kitchenStationId: cuisineId } });
  await prisma.product.update({ where: { id: T.biere.id }, data: { kitchenStationId: barId } });
});

describe("Phase 3 — écran cuisine", () => {
  it("un envoi crée un ticket par poste ; la liste se filtre par poste", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 2 });
    const saignant = T.cuisson.modifiers.find((m) => m.name === "Saignant")!;
    await addItem(T.actor, o.id, { productId: T.burger.id, quantity: 2, modifiers: [{ modifierId: saignant.id }], courseId: o.courses[2].id, notes: "sans oignons", seatNumber: 1 });
    await addItem(T.actor, o.id, { productId: T.entree.id, courseId: o.courses[1].id });
    await addItem(T.actor, o.id, { productId: T.biere.id, courseId: o.courses[0].id, seatNumber: 2 });
    await sendCourse(T.actor, o.id, { all: true });
    const all = await listKitchenTickets(T.est.id);
    expect(all.length).toBe(3);
    expect(all.every((t) => t.status === "NEW")).toBe(true);
    const cuisine = await listKitchenTickets(T.est.id, { stationId: cuisineId });
    expect(cuisine.length).toBe(2);
    const burgerTicket = cuisine.find((t) => t.items.some((i) => i.name === "Burger"))!;
    expect(burgerTicket.items[0].modifiers.map((m) => m.name)).toEqual(["Saignant"]);
    expect(burgerTicket.items[0].notes).toBe("sans oignons");
    expect(burgerTicket.order.table?.name).toBe("T01");
    expect(burgerTicket.course?.name).toBe("PLATS");
  });

  it("ACCEPTER → EN PRÉPARATION → PRÊT → TERMINÉ : articles, service et salle synchronisés", async () => {
    const o = await getOrder(T.est.id, (await prisma.order.findFirstOrThrow({ where: { tableId: T.t1.id, status: "SENT" } })).id);
    const ticket = (await listKitchenTickets(T.est.id, { stationId: cuisineId })).find((t) => t.course?.name === "PLATS")!;
    let t = await setTicketStatus(T.actor, ticket.id, "ACCEPTED");
    expect(t.status).toBe("ACCEPTED");
    expect(t.acceptedAt).not.toBeNull();
    t = await setTicketStatus(T.actor, ticket.id, "IN_PROGRESS");
    expect(t.startedAt).not.toBeNull();
    let order = await getOrder(T.est.id, o.id);
    expect(order.items.find((i) => i.name === "Burger")!.status).toBe("PREPARING");
    t = await setTicketStatus(T.actor, ticket.id, "READY");
    expect(t.readyAt).not.toBeNull();
    order = await getOrder(T.est.id, o.id);
    expect(order.items.find((i) => i.name === "Burger")!.status).toBe("READY");
    expect(order.courses.find((c) => c.name === "PLATS")!.status).toBe("READY");
    const floor = await getFloorStatus(T.est.id);
    expect(floor.rooms[0].tables.find((x) => x.id === T.t1.id)!.order!.readyCount).toBe(1);
    t = await setTicketStatus(T.actor, ticket.id, "DONE");
    expect(t.completedAt).not.toBeNull();
    order = await getOrder(T.est.id, o.id);
    expect(order.items.find((i) => i.name === "Burger")!.status).toBe("SERVED");
    expect(order.courses.find((c) => c.name === "PLATS")!.status).toBe("SERVED");
    // Le ticket terminé sort de la liste active mais reste rappelable
    expect((await listKitchenTickets(T.est.id)).some((x) => x.id === ticket.id)).toBe(false);
    expect((await listKitchenTickets(T.est.id, { includeDone: true })).some((x) => x.id === ticket.id)).toBe(true);
    t = await setTicketStatus(T.actor, ticket.id, "READY");
    expect(t.status).toBe("READY");
    expect(t.completedAt).toBeNull();
    order = await getOrder(T.est.id, o.id);
    expect(order.items.find((i) => i.name === "Burger")!.status).toBe("READY");
    const logs = await prisma.auditLog.findMany({ where: { action: "kitchen.ticket.status", entityId: ticket.id } });
    expect(logs.length).toBe(5);
  });

  it("cocher chaque article prêt fait passer le ticket PRÊT ; décocher le ramène en préparation", async () => {
    const ticket = (await listKitchenTickets(T.est.id, { stationId: barId }))[0];
    expect(ticket.status).toBe("NEW");
    let t = await setItemReady(T.actor, ticket.id, ticket.items[0].id, true);
    expect(t.status).toBe("READY");
    t = await setItemReady(T.actor, ticket.id, ticket.items[0].id, false);
    expect(t.status).toBe("IN_PROGRESS");
    expect(t.items[0].status).toBe("PREPARING");
  });

  it("résumé par poste et impression du bon cuisine", async () => {
    const s = await kitchenSummary(T.est.id);
    const cuisine = s.stations.find((x) => x.id === cuisineId)!;
    expect(cuisine.total).toBe(2);
    expect(cuisine.counts.READY).toBe(1);
    expect(s.all.total).toBe(3);
    expect(s.all.doneToday).toBeGreaterThanOrEqual(1);
    const ticket = (await listKitchenTickets(T.est.id, { stationId: cuisineId })).find((t) => t.items.some((i) => i.name === "Burger"))!;
    const html = await renderKitchenTicketHtml(T.est.id, ticket.id);
    expect(html).toContain("TABLE T01");
    expect(html).toContain("Burger");
    expect(html).toContain("Saignant");
    expect(html).toContain("sans oignons");
    const bytes = await renderKitchenTicketEscPos(T.est.id, ticket.id);
    expect(bytes[0]).toBe(0x1b);
    expect(Buffer.from(bytes).toString("latin1")).toContain("Burger");
  });

  it("annuler tous les articles d'un ticket l'annule ; annuler la commande annule ses tickets", async () => {
    const order = await prisma.order.findFirstOrThrow({ where: { tableId: T.t1.id, status: "SENT" } });
    const full = await getOrder(T.est.id, order.id);
    const salade = full.items.find((i) => i.name === "Salade")!;
    await removeItem(T.managerActor, order.id, salade.id, "Erreur");
    const saladeTicket = await prisma.kitchenTicket.findUniqueOrThrow({ where: { id: salade.kitchenTicketId! } });
    expect(saladeTicket.status).toBe("CANCELLED");
    expect((await listKitchenTickets(T.est.id)).some((t) => t.id === saladeTicket.id)).toBe(false);
    await expect(setTicketStatus(T.actor, saladeTicket.id, "READY")).rejects.toMatchObject({ code: "TICKET_CANCELLED" });
    await cancelOrder(T.managerActor, order.id, "Test");
    const tickets = await prisma.kitchenTicket.findMany({ where: { orderId: order.id } });
    expect(tickets.every((t) => t.status === "CANCELLED" || t.status === "DONE")).toBe(true);
    expect(await listKitchenTickets(T.est.id)).toEqual([]);
  });

  it("refuse un statut hors cycle", async () => {
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.eau.id });
    await sendCourse(T.actor, o.id, { all: true });
    const t = (await listKitchenTickets(T.est.id))[0];
    await expect(setTicketStatus(T.actor, t.id, "NEW")).rejects.toMatchObject({ code: "BAD_STATUS" });
    await expect(setTicketStatus({ ...T.actor, establishmentId: "00000000-0000-0000-0000-000000000000" }, t.id, "READY")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
