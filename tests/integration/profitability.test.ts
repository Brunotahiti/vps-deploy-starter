import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { addItem, createOrder, sendCourse } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { getDailySummary, getPeriodReport } from "@/server/services/reports";
import { localDay } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;
beforeAll(async () => { await resetDb(); T = await makeTenant("profit"); });

describe("rentabilité par plat", () => {
  it("classe les plats par marge brute HT, formules avec le coût de leurs composants, sans les produits sans coût", async () => {
    const o = await createOrder(T.actor, { type: "COUNTER" });
    const saignant = T.cuisson.modifiers.find((m) => m.name === "Saignant")!;
    await addItem(T.actor, o.id, { productId: T.burger.id, quantity: 2, modifiers: [{ modifierId: saignant.id }] }); // 2100 TTC à 13 %, coût 630
    await addItem(T.actor, o.id, { productId: T.biere.id });             // 600 TTC à 16 %, coût 210
    await addItem(T.actor, o.id, { productId: T.eau.id });               // 300 à 0 %, coût 90
    await sendCourse(T.actor, o.id, { all: true });
    await addPayments(T.actor, o.id, [{ method: "CARD", amount: 2100 * 2 + 600 + 300 }]);
    const day = localDay(new Date(), T.est.timezone);
    const s = await getDailySummary(T.est.id, day, T.est.timezone);
    const burger = s.byProduct.find((p) => p.name === "Burger")!;
    expect(burger.revenueHt).toBe(Math.round(4200 / 1.13));
    expect(burger.cost).toBe(1260);
    expect(burger.margin).toBe(burger.revenueHt - 1260);
    expect(burger.marginPct).toBe(Math.round(((burger.revenueHt - 1260) / burger.revenueHt) * 1000) / 10);
    const names = s.profitability.best.map((p) => p.name);
    expect(names[0]).toBe("Eau");       // 300 HT − 90 = 70 %
    expect(names).toContain("Burger");  // ~66 %
    expect(names).toContain("Bière");   // 517 − 210 ≈ 59 %
    expect(s.profitability.worst.every((p) => !names.includes(p.name))).toBe(true);
    expect(s.profitability.unknownCost).toBe(0);
    const period = await getPeriodReport(T.est.id, day, day, T.est.timezone);
    expect(period.profitability.best.length).toBeGreaterThan(0);
  });
});
