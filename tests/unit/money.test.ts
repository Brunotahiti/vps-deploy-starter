import { describe, expect, it } from "vitest";
import { formatMoney, splitTtc, splitEqual, applyBps, formatBps, roundHalfUp } from "@/lib/money";

describe("formatMoney", () => {
  it("affiche les F CFP sans décimales avec séparateur de milliers", () => {
    expect(formatMoney(2450)).toBe("2 450 F");
    expect(formatMoney(485300, "XPF")).toBe("485 300 F");
    expect(formatMoney(0)).toBe("0 F");
    expect(formatMoney(-500)).toBe("-500 F");
  });
  it("gère une devise à 2 décimales (architecture multi-devises)", () => {
    expect(formatMoney(245000, "EUR")).toBe("2 450,00 €");
    expect(formatMoney(1999, "EUR")).toBe("19,99 €");
  });
});

describe("TVA", () => {
  it("décompose un TTC en HT + TVA (13 %)", () => {
    const r = splitTtc(2100, 1300);
    expect(r.ht + r.tax).toBe(2100);
    expect(r.ht).toBe(1858);
    expect(r.tax).toBe(242);
  });
  it("TVA 16 % et exonéré", () => {
    expect(splitTtc(1160, 1600)).toEqual({ ht: 1000, tax: 160, ttc: 1160 });
    expect(splitTtc(300, 0)).toEqual({ ht: 300, tax: 0, ttc: 300 });
  });
  it("formate les points de base", () => {
    expect(formatBps(1300)).toBe("13 %");
    expect(formatBps(550)).toBe("5,50 %");
  });
});

describe("arithmétique", () => {
  it("répartit en parts égales entières", () => {
    expect(splitEqual(18000, 6)).toEqual([3000, 3000, 3000, 3000, 3000, 3000]);
    expect(splitEqual(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEqual(10000, 3).reduce((a, b) => a + b, 0)).toBe(10000);
  });
  it("applique un pourcentage", () => {
    expect(applyBps(12500, 1000)).toBe(1250);
    expect(applyBps(999, 500)).toBe(50);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });
});
