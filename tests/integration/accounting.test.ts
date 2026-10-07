import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { addItem, createOrder } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { openSession } from "@/server/services/cash";
import { addMovement, upsertIngredient, upsertSupplier } from "@/server/services/stock";
import { deleteExpense, getAccountingSummary, listExpenses, upsertExpense } from "@/server/services/accounting";
import { buildAccountingExport, buildExport, toCsv } from "@/server/reports/export";
import { endOfLocalDay, localDay, startOfLocalDay } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;
const TZ = "Pacific/Tahiti";
const today = localDay(new Date(), TZ);

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("compta");
  await openSession(T.managerActor, { openingFloat: 10000 });
  // Une vente : 2 salades (1 200 F, TVA 13 %) + 1 bière (600 F, TVA 16 %) = 3 000 F TTC, payée en espèces
  const o = await createOrder(T.actor, { type: "COUNTER" });
  await addItem(T.actor, o.id, { productId: T.entree.id, quantity: 2 });
  await addItem(T.actor, o.id, { productId: T.biere.id, quantity: 1 });
  await addPayments(T.actor, o.id, [{ method: "CASH", amount: 3000, tendered: 3000 }]);
  // Un achat entré en stock : 10 steaks à 300 F
  const steak = await upsertIngredient(T.managerActor, { name: "Steak", unit: "pce", avgCost: 300 });
  await addMovement(T.managerActor, { ingredientId: steak.id, kind: "PURCHASE", quantity: 10, unitCost: 300, reason: "Achat direct" });
});

describe("Comptabilité", () => {
  it("saisie des dépenses : catégorie, TVA déductible, payée ou à payer, fournisseur du stock", async () => {
    const sup = await upsertSupplier(T.managerActor, { name: "EDT" });
    const edt = await upsertExpense(T.managerActor, { date: today, label: "Électricité", category: "ENERGY", supplierId: sup.id, amountTtc: 11600, taxAmount: 1600, method: "TRANSFER" });
    expect(edt).toMatchObject({ amountHt: 10000, account: "606100", categoryLabel: "Électricité, eau, gaz", supplierName: "EDT", paid: true });
    expect(edt.paidAt).not.toBeNull(); // payée : date de paiement = date de la pièce par défaut
    const loyer = await upsertExpense(T.managerActor, { date: today, label: "Loyer", category: "RENT", supplierName: "SCI Tiare", amountTtc: 150000, taxAmount: 0, method: null });
    expect(loyer.paid).toBe(false);
    await expect(upsertExpense(T.managerActor, { date: today, label: "X", category: "INCONNUE", amountTtc: 100 })).rejects.toMatchObject({ code: "BAD_CATEGORY" });
    await expect(upsertExpense(T.managerActor, { date: today, label: "X", category: "OTHER", amountTtc: 100, taxAmount: 200 })).rejects.toMatchObject({ code: "BAD_TAX" });
    // Modification puis suppression
    const edited = await upsertExpense(T.managerActor, { id: loyer.id, date: today, label: "Loyer du mois", category: "RENT", supplierName: "SCI Tiare", amountTtc: 150000, taxAmount: 0, method: null });
    expect(edited.label).toBe("Loyer du mois");
    const extra = await upsertExpense(T.managerActor, { date: today, label: "À supprimer", category: "OTHER", amountTtc: 500 });
    await deleteExpense(T.managerActor, extra.id);
    const list = await listExpenses(T.est.id, startOfLocalDay(today, TZ), endOfLocalDay(today, TZ));
    expect(list.map((e) => e.label).sort()).toEqual(["Loyer du mois", "Électricité"]);
    // Isolation : une autre entreprise ne voit ni ne modifie ces dépenses
    const B = await makeTenant("compta-b");
    await expect(deleteExpense(B.managerActor, edt.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("synthèse : ventes HT et TVA par taux, achats du stock, dépenses, TVA à reverser, résultat", async () => {
    const s = await getAccountingSummary(T.est.id, today, today, TZ, { withStaff: true });
    expect(s.sales.ttc).toBe(3000);
    expect(s.sales.byRate.map((r) => [r.rateBps, r.ttc])).toEqual([[1300, 2400], [1600, 600]]);
    const tax13 = Math.round(2400 - 2400 / 1.13), tax16 = Math.round(600 - 600 / 1.16);
    expect(s.vat.collected).toBe(tax13 + tax16);
    expect(s.receipts).toEqual([{ method: "CASH", amount: 3000, count: 1 }]);
    expect(s.purchases.stock).toBe(3000); // 10 × 300
    expect(s.purchases.direct).toBe(3000);
    expect(s.expenses).toMatchObject({ ttc: 161600, tax: 1600, ht: 160000, unpaid: 150000, count: 2 });
    expect(s.expenses.byCategory.map((c) => c.category)).toEqual(["RENT", "ENERGY"]);
    expect(s.vat.deductible).toBe(1600);
    expect(s.vat.due).toBe(s.vat.collected - 1600);
    expect(s.staff.laborCost).toBe(0); // option Équipe ouverte, personne de pointé
    expect(s.result.result).toBe(s.result.revenueHt - 3000 - 160000);
    expect(s.result.marginPct).toBeLessThan(0);
  });

  it("exports : compte de résultat, dépenses et achats dans l'export comptable, écritures équilibrées, export dépenses et stock", async () => {
    const exp = await buildAccountingExport(T.est.id, today, today, TZ);
    const sheet = (name: string) => exp.sheets.find((s) => s.name === name)!;
    expect(exp.sheets.map((s) => s.name)).toEqual(expect.arrayContaining(["Résultat", "Dépenses", "Achats stock", "Écritures"]));
    expect(sheet("Dépenses").rows).toHaveLength(2);
    expect(sheet("Achats stock").rows[0]).toEqual(expect.arrayContaining(["Steak", 10, 300, 3000]));
    const entries = sheet("Écritures").rows;
    // Dépense payée : charge + TVA déductible / fournisseur, puis règlement fournisseur / banque
    expect(entries.some((r) => r[2] === "606100" && r[4] === 10000)).toBe(true);
    expect(entries.some((r) => r[2] === "445660" && r[4] === 1600)).toBe(true);
    expect(entries.filter((r) => r[2] === "401000")).toHaveLength(4); // EDT (crédit + règlement), loyer (crédit), achats stock (crédit)
    expect(entries.some((r) => r[2] === "512200" && r[5] === 11600)).toBe(true);
    expect(entries.some((r) => r[2] === "601000" && r[4] === 3000)).toBe(true);
    const totals = entries.reduce((a, r) => ({ d: a.d + Number(r[4]), c: a.c + Number(r[5]) }), { d: 0, c: 0 });
    expect(totals.d).toBe(totals.c);
    const result = Object.fromEntries(sheet("Résultat").rows.map((r) => [r[0], r[1]]));
    expect(result["Dépenses HT saisies"]).toBe(-160000);
    expect(result["TVA déductible (dépenses)"]).toBe(1600);
    expect(result["Dépenses à payer"]).toBe(150000);

    const expenses = await buildExport(T.est.id, "expenses", today, today, TZ);
    expect(expenses.sheets[0].rows.map((r) => r[1]).sort()).toEqual(["Loyer du mois", "Électricité"]);
    expect(toCsv(expenses.sheets)).toContain("Électricité;Électricité, eau, gaz;606100;EDT");

    const stock = await buildExport(T.est.id, "stock", today, today, TZ);
    expect(stock.sheets.map((s) => s.name)).toEqual(["Valorisation du stock", "Mouvements"]);
    expect(stock.sheets[0].rows.find((r) => r[0] === "Steak")).toEqual(["Steak", "Ingrédient", "pce", 10, 0, 300, 3000, 300]);
    expect(stock.sheets[0].rows.at(-1)![6]).toBe(3000);
    expect(stock.sheets[1].rows.some((r) => r[3] === "Achat" && r[4] === 10)).toBe(true);
  });
});
