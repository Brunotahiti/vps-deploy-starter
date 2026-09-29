import { describe, expect, it } from "vitest";
import { computeLine, computeOrderTotals } from "@/lib/order-calc";

describe("computeLine", () => {
  it("prix + options × quantité − remise", () => {
    const r = computeLine({ quantity: 2, unitPrice: 2100, modifiersTotal: 400, discountAmount: 0, taxRateBps: 1300 });
    expect(r.lineTotal).toBe(5000);
    expect(r.ht + r.taxAmount).toBe(5000);
  });
  it("ligne annulée = 0", () => {
    expect(computeLine({ quantity: 1, unitPrice: 2100, modifiersTotal: 0, discountAmount: 0, taxRateBps: 1300, voided: true }).lineTotal).toBe(0);
  });
});

describe("computeOrderTotals", () => {
  const lines = [
    { quantity: 1, unitPrice: 2100, modifiersTotal: 250, discountAmount: 0, taxRateBps: 1300, taxRateName: "Resto" },
    { quantity: 2, unitPrice: 600, modifiersTotal: 0, discountAmount: 0, taxRateBps: 1600, taxRateName: "Normal" },
    { quantity: 1, unitPrice: 300, modifiersTotal: 0, discountAmount: 0, taxRateBps: 0, taxRateName: "Exo" },
  ];
  it("ventile la TVA par taux et HT + TVA = TTC", () => {
    const t = computeOrderTotals(lines);
    expect(t.subtotal).toBe(3850);
    expect(t.total).toBe(3850);
    expect(t.htTotal + t.taxTotal).toBe(t.total);
    expect(t.breakdown.map((b) => b.rateBps)).toEqual([1600, 1300, 0]);
    const b13 = t.breakdown.find((b) => b.rateBps === 1300)!;
    expect(b13.ttc).toBe(2350);
    expect(b13.ht + b13.tax).toBe(2350);
    expect(t.breakdown.find((b) => b.rateBps === 0)!.tax).toBe(0);
    expect(t.breakdown.reduce((a, b) => a + b.ttc, 0)).toBe(t.total);
  });
  it("répartit une remise globale au prorata sans casser la ventilation", () => {
    const t = computeOrderTotals(lines, 500);
    expect(t.discountTotal).toBe(500);
    expect(t.total).toBe(3350);
    expect(t.breakdown.reduce((a, b) => a + b.ttc, 0)).toBe(3350);
    expect(t.htTotal + t.taxTotal).toBe(3350);
  });
  it("plafonne la remise au sous-total", () => {
    expect(computeOrderTotals(lines, 99999).total).toBe(0);
  });
  it("formule 3 500 F + entrecôte +500 + dessert premium +300 = 4 300 F", () => {
    const t = computeOrderTotals([
      { quantity: 1, unitPrice: 3500, modifiersTotal: 0, discountAmount: 0, taxRateBps: 1300 },
      { quantity: 1, unitPrice: 500, modifiersTotal: 0, discountAmount: 0, taxRateBps: 1300 },
      { quantity: 1, unitPrice: 300, modifiersTotal: 0, discountAmount: 0, taxRateBps: 1300 },
    ]);
    expect(t.total).toBe(4300);
  });
});
