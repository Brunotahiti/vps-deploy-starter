import { describe, expect, it } from "vitest";
import { encodeText } from "@/lib/escpos";
import { colsFor, kitchenTickets, pickReceiptPrinter, receiptOps, type LocalOrder, type LocalPrinter } from "@/lib/offline/print-local";

const item = (id: string, name: string, extra: Partial<LocalOrder["items"][number]> = {}) => ({ id, name, quantity: 1, unitPrice: 1200, modifiersTotal: 0, discountAmount: 0, lineTotal: 1200, taxRateBps: 1300, taxRateName: "TVA 13 %", status: "SENT", parentItemId: null, courseId: "c-plats", kitchenStationId: "s-chaud", notes: null, seatNumber: null, isUrgent: false, modifiers: [], ...extra });
const order: LocalOrder = {
  number: "20261001-0042", type: "DINE_IN", status: "PAID", covers: 2, discountTotal: 0, total: 2900, paidTotal: 2900, customerName: null, notes: null,
  openedAt: "2026-10-01T20:00:00Z", closedAt: "2026-10-01T21:00:00Z", table: { name: "T05" }, server: { firstName: "Moana", displayName: null },
  courses: [{ id: "c-plats", name: "PLATS" }, { id: "c-boissons", name: "BOISSONS" }],
  items: [item("i1", "Poisson cru", { notes: "sans oignon" }), item("i2", "Hinano", { unitPrice: 500, lineTotal: 500, taxRateBps: 1600, courseId: "c-boissons", kitchenStationId: "s-bar" }), item("i3", "Mahi mahi", { lineTotal: 1200 }), item("i4", "Annulé", { status: "VOIDED" })],
  payments: [{ method: "CASH", amount: 2900, status: "COMPLETED" }],
};

describe("impression sans internet : documents construits sur la tablette", () => {
  it("ticket client : établissement, articles, total TTC, TVA et paiement", () => {
    const text = encodeText(receiptOps(order, { name: "Le Mana Beach", city: "Papeete", currency: "XPF", timezone: "Pacific/Tahiti" }));
    expect(text).toContain("Le Mana Beach");
    expect(text).toContain("20261001-0042");
    expect(text).toMatch(/1 x Poisson cru/);
    expect(text).not.toContain("Annule");
    expect(text).toMatch(/TOTAL TTC\s+2 900 F/);
    expect(text).toMatch(/Especes\s+2 900 F/);
    expect(text).not.toContain("?"); // montants lisibles sur l'imprimante (espaces insécables remplacés)
    expect(text).toContain("Mauruuru");
  });

  it("bons cuisine : un par suite et par poste, avec les notes, seulement les articles envoyés", () => {
    const tickets = kitchenTickets(order, ["i1", "i2", "i3"], [{ id: "s-chaud", name: "Chaud" }, { id: "s-bar", name: "Bar" }], "Pacific/Tahiti");
    expect(tickets.map((t) => t.stationId).sort()).toEqual(["s-bar", "s-chaud"]);
    const chaud = encodeText(tickets.find((t) => t.stationId === "s-chaud")!.ops);
    expect(chaud).toContain("TABLE T05");
    expect(chaud).toContain("Chaud - PLATS");
    expect(chaud).toContain("1 x Poisson cru");
    expect(chaud).toContain("<< sans oignon >>");
    expect(chaud).toContain("1 x Mahi mahi");
    expect(chaud).toContain("envoye sans internet");
    expect(chaud).not.toContain("Hinano");
  });

  it("imprimante de ticket : celle de la caisse d'abord, sinon la commune ; largeur 58 mm", () => {
    const p = (id: string, terminalId: string | null, kind: "RECEIPT" | "KITCHEN" = "RECEIPT"): LocalPrinter => ({ id, name: id, kind, driver: "agent", agentUrl: "http://127.0.0.1:9123/print", paperWidthMm: 80, stationId: null, terminalId, hasDrawer: false, drawerPin: 2 });
    expect(pickReceiptPrinter([p("commune", null), p("caisse-2", "t2"), p("cuisine", null, "KITCHEN")], "t2")?.id).toBe("caisse-2");
    expect(pickReceiptPrinter([p("commune", null), p("caisse-2", "t2")], "t1")?.id).toBe("commune");
    expect(colsFor(58)).toBe(32);
    expect(colsFor(80)).toBe(42);
  });
});
