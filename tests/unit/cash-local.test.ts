import { describe, expect, it } from "vitest";
import { summarize } from "@/lib/offline/cash-local";
import type { SessionReport } from "@/components/pos/types";

const mv = (kind: string, amount: number) => ({ kind, amount });
const report = (movements: { kind: string; amount: number }[], payments: { method: string; amount: number }[]) =>
  ({ session: { id: "s", openingFloat: 10000, movements, payments: payments.map((p) => ({ ...p, tipAmount: 0, refundedAmount: 0 })) }, summary: {} }) as unknown as SessionReport;

describe("caisse tenue sur la tablette pendant une coupure", () => {
  it("espèces théoriques = fond + ventes espèces + entrées − sorties (même calcul que le serveur)", () => {
    const r = summarize(report([mv("OPENING", 10000), mv("SALE", 2900), mv("PAY_IN", 500), mv("PAY_OUT", -1200), mv("DEPOSIT", -5000)], [{ method: "CASH", amount: 2900 }, { method: "CARD", amount: 4100 }]));
    expect(r.summary.cashExpected).toBe(10000 + 2900 + 500 - 1200 - 5000);
    expect(r.summary.cashSales).toBe(2900);
    expect(r.summary.payOuts).toBe(-1200);
    expect(r.summary.byMethod.CARD).toMatchObject({ count: 1, amount: 4100 });
    expect(r.summary.totalSales).toBe(7000);
    expect(r.summary.openingFloat).toBe(10000);
  });
});
