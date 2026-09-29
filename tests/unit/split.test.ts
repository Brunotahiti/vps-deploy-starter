import { describe, expect, it } from "vitest";
import { splitEqually, splitBySeat, splitByItems, validateCustomAmount } from "@/lib/split";

describe("partage d'addition", () => {
  it("parts égales : 18 000 F / 6 = 3 000 F", () => {
    expect(splitEqually(18000, 6)).toEqual([3000, 3000, 3000, 3000, 3000, 3000]);
  });
  it("par client : chaque siège paie ses articles + sa part des articles partagés", () => {
    const items = [
      { id: "a", lineTotal: 2100, seatNumber: 1 }, { id: "b", lineTotal: 1200, seatNumber: 2 }, { id: "c", lineTotal: 900, seatNumber: null },
    ];
    const r = splitBySeat(items, 2);
    expect(r).toEqual([{ seat: 1, amount: 2550, itemIds: ["a"] }, { seat: 2, amount: 1650, itemIds: ["b"] }]);
    expect(r.reduce((a, b) => a + b.amount, 0)).toBe(4200);
  });
  it("par article", () => {
    expect(splitByItems([{ id: "a", lineTotal: 2100, seatNumber: 1 }, { id: "b", lineTotal: 1200, seatNumber: 1 }], ["b"])).toBe(1200);
  });
  it("montant personnalisé", () => {
    expect(validateCustomAmount(500, 1000)).toBe(true);
    expect(validateCustomAmount(1500, 1000)).toBe(false);
    expect(validateCustomAmount(0, 1000)).toBe(false);
  });
});
