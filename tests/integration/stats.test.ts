import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, createOrder, getOrder, sendCourse } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { getStats } from "@/server/services/stats";
import { localDay } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;
const TZ = "Pacific/Tahiti";

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("stats");
});

describe("Statistiques de période", () => {
  it("agrège ventes, cuisine, réservations, clients et produit des faits marquants", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 3 });
    const saignant = T.cuisson.modifiers.find((m) => m.name === "Saignant")!;
    await addItem(T.actor, o.id, { productId: T.burger.id, quantity: 2, modifiers: [{ modifierId: saignant.id }] });
    await sendCourse(T.actor, o.id, { all: true });
    await prisma.kitchenTicket.updateMany({ where: { orderId: o.id }, data: { readyAt: new Date(Date.now() + 600_000) } });
    const full = await getOrder(T.est.id, o.id);
    await addPayments(T.actor, o.id, [{ method: "CARD", amount: full.total }]);
    await prisma.reservation.createMany({ data: [
      { establishmentId: T.est.id, name: "A", startsAt: new Date(), partySize: 4, status: "COMPLETED" },
      { establishmentId: T.est.id, name: "B", startsAt: new Date(), partySize: 2, status: "NO_SHOW" },
    ] });
    const today = localDay(new Date(), TZ);
    const s = await getStats(T.est.id, today, today, TZ);
    expect(s.period.tickets).toBe(1);
    expect(s.period.covers).toBe(3);
    expect(s.kitchen.tickets).toBeGreaterThanOrEqual(1);
    expect(s.kitchen.avgPrepSec).toBeGreaterThanOrEqual(590);
    expect(s.reservations).toMatchObject({ total: 2, completed: 1, noShow: 1, noShowPct: 50 });
    expect(s.service.dineInTickets).toBe(1);
    expect(s.service.avgCoversPerTable).toBe(3);
    expect(s.highlights.some((h) => h.text.includes("Produit star"))).toBe(true);
    expect(s.highlights.some((h) => h.kind === "warn" && h.text.includes("no-show"))).toBe(true);
  });
});
