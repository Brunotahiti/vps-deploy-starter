import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, createOrder, removeItem, sendCourse, setCourseStatus } from "@/server/services/orders";
import { setTicketStatus } from "@/server/services/kitchen";
import { upsertTable } from "@/server/services/floor";
import { dishStage, listKitchenChanges, modifyItem, orderKitchenState, setChangeStatus } from "@/server/services/kitchen-changes";
import { renderKitchenChangeDoc } from "@/server/receipts/kitchen-ticket";

let T: Awaited<ReturnType<typeof makeTenant>>;
const mod = (group: { modifiers: { id: string; name: string }[] }, name: string) => group.modifiers.find((m) => m.name === name)!.id;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("kchg");
});

/** Une table neuve (T1x) : un burger saignant + bacon envoyé en cuisine */
let n = 0;
async function sentBurger() {
  const table = await upsertTable(T.managerActor, { roomId: T.room.id, name: `T1${++n}`, seats: 4 });
  const o = await createOrder(T.actor, { type: "DINE_IN", tableId: table.id, covers: 2 });
  const withItem = await addItem(T.actor, o.id, { productId: T.burger.id, quantity: 1, modifiers: [{ modifierId: mod(T.cuisson, "Saignant") }, { modifierId: mod(T.supp, "Bacon") }] });
  const sent = await sendCourse(T.actor, o.id, { all: true, print: false });
  const item = sent.items.find((i) => i.name === "Burger")!;
  expect(withItem.total).toBe(2350);
  return { order: sent, item };
}

describe("circuit salle → cuisine", () => {
  it("statuts du plat : Nouvelle, Acceptée, En préparation, Prête, Servie", () => {
    expect(dishStage("PENDING", null)).toBeNull();
    expect(dishStage("SENT", "NEW")).toBe("NEW");
    expect(dishStage("SENT", "ACCEPTED")).toBe("ACCEPTED");
    expect(dishStage("PREPARING", "IN_PROGRESS")).toBe("PREPARING");
    expect(dishStage("READY", "READY")).toBe("READY");
    expect(dishStage("SERVED", "DONE")).toBe("SERVED");
  });

  it("modification d'un plat envoyé : la cuisine reçoit ❌ / ➕ / note, le prix suit, l'historique reste", async () => {
    const { order, item } = await sentBurger();
    const after = await modifyItem(T.actor, order.id, item.id, { modifiers: [{ modifierId: mod(T.cuisson, "Saignant") }, { modifierId: mod(T.supp, "Fromage") }], note: "Sans sauce" });
    const burger = after.items.find((i) => i.id === item.id)!;
    expect(burger.modifiers.map((m) => m.name).sort()).toEqual(["Fromage", "Saignant"]);
    expect(burger.notes).toBe("Sans sauce");
    expect(after.total).toBe(2100 + 150);
    const [change] = await listKitchenChanges(T.est.id);
    expect(change).toMatchObject({ kind: "MODIFY", urgent: false, stage: "NEW", itemName: "Burger", tableName: "T11", removed: ["Bacon"], added: ["Fromage"], note: "Sans sauce", status: "REQUESTED", requestedByName: "Server" });
    // Bon imprimé « MODIFICATION — TABLE T01 »
    const text = JSON.stringify(await renderKitchenChangeDoc(T.est.id, change.id));
    expect(text).toContain("MODIFICATION");
    expect(text).toContain("TABLE T11");
    expect(text).toContain("SANS Bacon");
    // La cuisine la voit puis l'applique ; la salle suit chaque étape
    await setChangeStatus(T.managerActor, change.id, "SEEN");
    expect((await orderKitchenState(T.est.id, order.id)).changes[0].status).toBe("SEEN");
    await setChangeStatus(T.managerActor, change.id, "APPLIED");
    expect((await orderKitchenState(T.est.id, order.id)).changes[0].status).toBe("APPLIED");
    expect(await prisma.auditLog.count({ where: { action: "item.modify", entityId: item.id } })).toBe(1);
    await expect(modifyItem(T.actor, order.id, item.id, { modifiers: [{ modifierId: mod(T.cuisson, "Saignant") }, { modifierId: mod(T.supp, "Fromage") }], note: "Sans sauce" })).rejects.toMatchObject({ code: "NO_CHANGE" });
  });

  it("plat déjà prêt : modification urgente, il repart en préparation ; plat servi : plus modifiable", async () => {
    const { order, item } = await sentBurger();
    await setTicketStatus(T.managerActor, item.kitchenTicketId!, "READY");
    expect((await orderKitchenState(T.est.id, order.id)).stages[item.id]).toBe("READY");
    await modifyItem(T.actor, order.id, item.id, { modifiers: [{ modifierId: mod(T.cuisson, "À point") }] });
    const state = await orderKitchenState(T.est.id, order.id);
    expect(state.stages[item.id]).toBe("PREPARING");
    expect(state.changes[0]).toMatchObject({ urgent: true, stage: "READY", removed: expect.arrayContaining(["Saignant", "Bacon"]), added: ["À point"] });
    expect((await prisma.kitchenTicket.findUniqueOrThrow({ where: { id: item.kitchenTicketId! } })).status).toBe("IN_PROGRESS");
    await setCourseStatus(T.actor, order.id, item.courseId!, "SERVED");
    await expect(modifyItem(T.actor, order.id, item.id, { modifiers: [{ modifierId: mod(T.cuisson, "Saignant") }] })).rejects.toMatchObject({ status: 409, code: "ALREADY_SERVED" });
  });

  it("annulation d'un plat en préparation : « ANNULATION » urgente pour la cuisine, vue = appliquée, prix retiré", async () => {
    const { order, item } = await sentBurger();
    await setTicketStatus(T.managerActor, item.kitchenTicketId!, "IN_PROGRESS");
    const after = await removeItem(T.managerActor, order.id, item.id, "Le client a changé d'avis");
    expect(after.items.find((i) => i.id === item.id)!.status).toBe("VOIDED");
    expect(after.total).toBe(0);
    const change = (await orderKitchenState(T.est.id, order.id)).changes[0];
    expect(change).toMatchObject({ kind: "CANCEL", urgent: true, stage: "PREPARING", reason: "Le client a changé d'avis" });
    expect(JSON.stringify(await renderKitchenChangeDoc(T.est.id, change.id))).toContain("ANNULATION");
    const seen = await setChangeStatus(T.managerActor, change.id, "SEEN");
    expect(seen.status).toBe("APPLIED");
  });

  it("un plat pas encore envoyé se modifie sans déranger la cuisine", async () => {
    const o = await createOrder(T.actor, { type: "TAKEAWAY" });
    const withItem = await addItem(T.actor, o.id, { productId: T.burger.id, quantity: 1, modifiers: [{ modifierId: mod(T.cuisson, "Saignant") }] });
    const before = await prisma.kitchenChange.count();
    await modifyItem(T.actor, o.id, withItem.items[0].id, { modifiers: [{ modifierId: mod(T.cuisson, "À point") }] });
    expect(await prisma.kitchenChange.count()).toBe(before);
  });
});
