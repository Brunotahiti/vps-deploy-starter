import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, cancelOrder, createOrder, getOrder, requestBill, sendCourse, setCourseStatus } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { listKitchenTickets, setTicketStatus } from "@/server/services/kitchen";
import { getFloorStatus } from "@/server/services/floor";
import { assignServer, completeReminder, listReminders, orderTimeline, serviceSettings, setStepStatus, snoozeReminder, updateServiceSettings } from "@/server/services/service-tracking";

let T: Awaited<ReturnType<typeof makeTenant>>;
beforeAll(async () => { await resetDb(); T = await makeTenant("service"); });

const open = async (tableId: string) => createOrder(T.actor, { type: "DINE_IN", tableId, covers: 2, courses: [{ id: crypto.randomUUID(), name: "APÉRITIFS" }, { id: crypto.randomUUID(), name: "PLATS" }, { id: crypto.randomUUID(), name: "DESSERTS" }] });
const due = async (orderId?: string) => (await listReminders(T.est.id, { userId: T.server.id })).due.filter((r) => !orderId || r.orderId === orderId);
const all = async (orderId: string) => { const l = await listReminders(T.est.id, { userId: T.server.id }); return [...l.due, ...l.upcoming].filter((r) => r.orderId === orderId); };

describe("Phase 9 — suivi de service", () => {
  it("réglages par défaut, activation et étapes configurables", async () => {
    const s = await serviceSettings(T.est.id);
    expect(s.enabled).toBe(true);
    expect(s.steps.length).toBe(9);
    const u = await updateServiceSettings(T.managerActor, { delays: { welcome: 0, drinksCheck: 0, foodCheck: 0, dessertOffer: 0, dessertCheck: 0, bill: 0, late: 5 } });
    expect(u.delays.welcome).toBe(0);
    expect(u.steps.length).toBe(9);
  });

  it("parcours complet : accueil → boissons → à apporter → apporté → vérification → plats → dessert → addition → clôture", async () => {
    const o = await open(T.t1.id);
    expect(await prisma.tableServiceStep.count({ where: { orderId: o.id } })).toBe(9);
    let d = await due(o.id);
    expect(d.length).toBe(1);
    expect(d[0].kind).toBe("TAKE_ORDER");
    expect(d[0].tableName).toBe("T01");
    // Envoi des boissons : la prise de commande boissons est faite, le rappel disparaît
    const aperos = o.courses[0];
    await addItem(T.actor, o.id, { productId: T.biere.id, courseId: aperos.id });
    await sendCourse(T.actor, o.id, { courseId: aperos.id });
    expect((await prisma.tableServiceStep.findUnique({ where: { orderId_key: { orderId: o.id, key: "drinks_order" } } }))!.status).toBe("DONE");
    expect((await prisma.tableServiceStep.findUnique({ where: { orderId_key: { orderId: o.id, key: "welcome" } } }))!.status).toBe("DONE");
    expect(await due(o.id)).toHaveLength(0);
    // Cuisine : prêt → « à apporter » ; terminé en cuisine ne vaut pas servi
    const tickets = await listKitchenTickets(T.est.id, {});
    const tk = tickets.find((t) => t.orderId === o.id)!;
    await setTicketStatus(T.actor, tk.id, "READY");
    d = await due(o.id);
    expect(d.length).toBe(1);
    expect(d[0].kind).toBe("BRING");
    expect(d[0].label).toContain("Bière");
    await setTicketStatus(T.actor, tk.id, "DONE");
    expect((await getOrder(T.est.id, o.id)).items[0].status).toBe("READY");
    expect((await due(o.id)).filter((r) => r.kind === "BRING")).toHaveLength(1);
    // Apporté à la table (via le rappel) : article servi, vérification boissons programmée
    await completeReminder(T.actor, d[0].id);
    expect((await getOrder(T.est.id, o.id)).items[0].status).toBe("SERVED");
    let r = await all(o.id);
    expect(r.map((x) => x.kind)).toEqual(["CHECK"]);
    // Vérification faite → prise de commande des plats demandée
    await completeReminder(T.actor, r[0].id);
    expect((await prisma.tableServiceStep.findUnique({ where: { orderId_key: { orderId: o.id, key: "drinks_check" } } }))!.status).toBe("DONE");
    r = await all(o.id);
    expect(r.map((x) => x.kind)).toEqual(["TAKE_ORDER"]);
    expect(r[0].label).toContain("plats");
    // Report : échéance décalée et compteur
    const snoozed = await snoozeReminder(T.actor, r[0].id, 10);
    expect(snoozed.snoozeCount).toBe(1);
    expect(snoozed.dueAt.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(await due(o.id)).toHaveLength(0);
    // Plats envoyés → servis via « Marquer servi » sur le service → vérification puis dessert
    const plats = o.courses[1];
    await addItem(T.actor, o.id, { productId: T.eau.id, courseId: plats.id });
    await sendCourse(T.actor, o.id, { courseId: plats.id });
    expect(await all(o.id)).toHaveLength(0); // le rappel « plats » est levé par l'envoi
    await setCourseStatus(T.actor, o.id, plats.id, "SERVED");
    r = await all(o.id);
    expect(r.map((x) => x.kind)).toEqual(["CHECK"]);
    await completeReminder(T.actor, r[0].id);
    r = await all(o.id);
    expect(r.map((x) => x.kind)).toEqual(["DESSERT"]);
    // Le serveur décide que le dessert n'est pas nécessaire : le rappel tombe
    await setStepStatus(T.actor, o.id, "dessert_offer", "NOT_NEEDED", "Clients pressés");
    expect(await all(o.id)).toHaveLength(0);
    const tl = await orderTimeline(T.est.id, o.id);
    expect(tl.steps.find((s) => s.key === "dessert_offer")!.status).toBe("NOT_NEEDED");
    expect(tl.events.some((e) => e.kind === "served")).toBe(true);
    expect(tl.next?.label).toBeTruthy();
    // Addition puis paiement : étape faite, plus aucun rappel
    await requestBill(T.actor, o.id);
    expect((await prisma.tableServiceStep.findUnique({ where: { orderId_key: { orderId: o.id, key: "bill" } } }))!.status).toBe("DONE");
    await addPayments(T.actor, o.id, [{ method: "CARD", amount: (await getOrder(T.est.id, o.id)).total }]);
    expect(await prisma.serviceReminder.count({ where: { orderId: o.id, status: "OPEN" } })).toBe(0);
    expect((await prisma.auditLog.count({ where: { action: { in: ["service.reminder.done", "service.reminder.snooze", "service.step"] } } }))).toBeGreaterThanOrEqual(5);
  });

  it("plan de salle : action et initiales du serveur ; attribution ; annulation ; rappels visibles par l'équipe", async () => {
    const o = await open(T.t2.id);
    const floor = await getFloorStatus(T.est.id);
    const t2 = floor.rooms[0].tables.find((t) => t.name === "T02")!;
    expect(t2.serverInitials).toBe("SS");
    expect(t2.service?.kind).toBe("TAKE_ORDER");
    // Attribution à un autre serveur : les rappels suivent, le manager ne voit plus ceux du serveur
    await assignServer(T.managerActor, o.id, T.manager.id);
    expect((await listReminders(T.est.id, { userId: T.server.id })).due.filter((r) => r.orderId === o.id)).toHaveLength(0);
    expect((await listReminders(T.est.id, { userId: T.manager.id })).due.filter((r) => r.orderId === o.id)).toHaveLength(1);
    await updateServiceSettings(T.managerActor, { assignTo: "TEAM" });
    expect((await listReminders(T.est.id, { userId: T.server.id })).due.filter((r) => r.orderId === o.id)).toHaveLength(1);
    // Annulation de la commande : rappels annulés
    await cancelOrder(T.managerActor, o.id, "Client parti");
    expect(await prisma.serviceReminder.count({ where: { orderId: o.id, status: "OPEN" } })).toBe(0);
    // Suivi désactivé : plus de parcours
    await updateServiceSettings(T.managerActor, { enabled: false });
    const o2 = await open(T.t2.id);
    expect(await prisma.tableServiceStep.count({ where: { orderId: o2.id } })).toBe(0);
  });
});
