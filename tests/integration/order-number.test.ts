import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { createOrder } from "@/server/services/orders";
import { localDay } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("numero");
});

describe("numéro de commande", () => {
  it("ne réutilise jamais un numéro déjà pris (démo, import, restauration) : repart après le plus grand du jour", async () => {
    const day = localDay(new Date(), T.est.timezone);
    const prefix = day.replace(/-/g, "");
    // Compteur à 200 mais commandes déjà numérotées 0201 à 0203 (cas du restaurant exemple)
    await prisma.orderCounter.create({ data: { establishmentId: T.est.id, day, value: 200 } });
    for (const n of [201, 202, 203]) await prisma.order.create({ data: { establishmentId: T.est.id, number: `${prefix}-0${n}`, type: "TAKEAWAY", status: "PAID" } });
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 2 });
    expect(o.number).toBe(`${prefix}-0204`);
    const next = await createOrder(T.actor, { type: "TAKEAWAY" });
    expect(next.number).toBe(`${prefix}-0205`);
    expect((await prisma.orderCounter.findUnique({ where: { establishmentId_day: { establishmentId: T.est.id, day } } }))?.value).toBe(205);
  });
});
