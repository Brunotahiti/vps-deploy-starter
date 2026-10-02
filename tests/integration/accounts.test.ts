import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { sentMails } from "@/server/email/mailer";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { lockedPermissions } from "@/lib/options";
import { addItem, createOrder } from "@/server/services/orders";
import { addPayments, refundPayment } from "@/server/services/payments";
import { openSession } from "@/server/services/cash";
import { buildAccountingExport } from "@/server/reports/export";
import { accountsForPos, createInvoice, getAccount, getInvoice, listAccounts, recordSettlement, remindInvoice, renderInvoicePdf, upsertAccount } from "@/server/services/accounts";

let T: Awaited<ReturnType<typeof makeTenant>>;
let mairie: Awaited<ReturnType<typeof upsertAccount>>;

/** Commande de 2 salades (TVA 13 %) et 1 bière (TVA 16 %) : 3 000 F */
async function meal() {
  const o = await createOrder(T.actor, { type: "COUNTER" });
  await addItem(T.actor, o.id, { productId: T.entree.id, quantity: 2 });
  await addItem(T.actor, o.id, { productId: T.biere.id });
  return o;
}

beforeAll(async () => {
  process.env.EMAIL_TRANSPORT = "memory";
  await resetDb();
  T = await makeTenant("comptes");
});

describe("Comptes clients & factures pro", () => {
  it("option et droits : la caisse met sur compte, le gérant facture", () => {
    expect(lockedPermissions(["stock"]).has("accounts.charge")).toBe(true);
    expect(lockedPermissions(["accounts"]).has("accounts.manage")).toBe(false);
    expect(SYSTEM_ROLES.server.permissions).toContain("accounts.charge");
    expect(SYSTEM_ROLES.server.permissions).not.toContain("accounts.manage");
    expect(SYSTEM_ROLES.manager.permissions).toEqual(expect.arrayContaining(["accounts.charge", "accounts.manage"]));
  });

  it("addition sur compte : compte obligatoire, puis commande soldée et encours mis à jour", async () => {
    mairie = await upsertAccount(T.managerActor, { name: "Mairie de Punaauia", tahitiNumber: "A12345", contactName: "Service compta", email: "compta@mairie.pf", address: "BP 1, Punaauia", creditLimit: 8000, paymentTermsDays: 30 });
    const o = await meal();
    await expect(addPayments(T.actor, o.id, [{ method: "ACCOUNT", amount: 3000 }])).rejects.toMatchObject({ code: "ACCOUNT_REQUIRED" });
    const r = await addPayments(T.actor, o.id, [{ method: "ACCOUNT", amount: 3000, customerAccountId: mairie.id }]);
    expect(r.order.status).toBe("PAID");
    expect(r.payments[0]).toMatchObject({ method: "ACCOUNT", customerAccountId: mairie.id, cashSessionId: null });
    expect((await accountsForPos(T.est.id))[0]).toMatchObject({ name: "Mairie de Punaauia", balance: 3000, creditLimit: 8000, available: 5000 });
  });

  it("plafond d'encours : refusé au-delà, sauf au rejeu d'un encaissement fait hors ligne", async () => {
    const o1 = await meal();
    await addPayments(T.actor, o1.id, [{ method: "ACCOUNT", amount: 3000, customerAccountId: mairie.id }]); // encours 6 000
    const o2 = await meal();
    await expect(addPayments(T.actor, o2.id, [{ method: "ACCOUNT", amount: 3000, customerAccountId: mairie.id }])).rejects.toMatchObject({ status: 409, code: "CREDIT_LIMIT" });
    // Une partie sur compte (dans le plafond), le reste en carte
    await addPayments(T.actor, o2.id, [{ method: "ACCOUNT", amount: 2000, customerAccountId: mairie.id }, { method: "CARD", amount: 1000 }]);
    expect((await accountsForPos(T.est.id))[0]).toMatchObject({ balance: 8000, available: 0 });
    const o3 = await meal();
    const replay = await addPayments(T.actor, o3.id, [{ method: "ACCOUNT", amount: 3000, customerAccountId: mairie.id }], { offlineReplay: true });
    expect(replay.order.status).toBe("PAID");
    // Remboursement d'une consommation : l'encours baisse
    await refundPayment(T.managerActor, replay.payments[0].id, { amount: 3000, reason: "Erreur de compte" });
    expect((await accountsForPos(T.est.id))[0].balance).toBe(8000);
  });

  it("autre établissement ou compte fermé : refusé ; sans l'option : refusé", async () => {
    const other = await makeTenant("comptes-autre", { options: ["stock"] });
    const o = await createOrder(other.actor, { type: "COUNTER" });
    await addItem(other.actor, o.id, { productId: other.eau.id });
    await expect(addPayments(other.actor, o.id, [{ method: "ACCOUNT", amount: 300, customerAccountId: mairie.id }])).rejects.toMatchObject({ code: "OPTION_REQUIRED" });
    await prisma.organization.update({ where: { id: other.org.id }, data: { options: ["accounts"] } });
    await expect(addPayments(other.actor, o.id, [{ method: "ACCOUNT", amount: 300, customerAccountId: mairie.id }])).rejects.toMatchObject({ status: 404 });
    const ferme = await upsertAccount(T.managerActor, { name: "Ancien client", isActive: false });
    const o2 = await meal();
    await expect(addPayments(T.actor, o2.id, [{ method: "ACCOUNT", amount: 3000, customerAccountId: ferme.id }])).rejects.toMatchObject({ code: "ACCOUNT_INACTIVE" });
  });

  it("facture : numérotation continue, consommations reprises une seule fois, TVA par taux", async () => {
    const issued = new Date("2026-10-31T20:00:00Z");
    const inv = await createInvoice(T.managerActor, mairie.id, {}, issued);
    const year = 2026;
    expect(inv.number).toBe(`FA-${year}-0001`);
    expect(inv.totalTtc).toBe(8000); // 3 000 + 3 000 + 2 000 (la consommation remboursée n'est pas facturée)
    const full = await getInvoice(T.est.id, inv.id);
    expect(full.lines).toHaveLength(3);
    expect(full.lines.every((l) => l.ttc === l.taxes.reduce((s, t) => s + t.ttc, 0))).toBe(true);
    expect(full.taxes.map((t) => t.rateBps)).toEqual([1300, 1600]);
    expect(full.taxes.reduce((s, t) => s + t.ttc, 0)).toBe(8000);
    expect(full.buyer).toMatchObject({ name: "Mairie de Punaauia", tahitiNumber: "A12345" });
    expect(full.dueAt.getTime() - full.issuedAt.getTime()).toBe(30 * 86_400_000);
    await expect(createInvoice(T.managerActor, mairie.id, {}, issued)).rejects.toMatchObject({ code: "NOTHING_TO_INVOICE" });
    // Plafond relevé, nouvelle consommation → facture suivante
    await upsertAccount(T.managerActor, { id: mairie.id, name: "Mairie de Punaauia", tahitiNumber: "A12345", contactName: "Service compta", email: "compta@mairie.pf", address: "BP 1, Punaauia", creditLimit: 20000 });
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.eau.id });
    await addPayments(T.actor, o.id, [{ method: "ACCOUNT", amount: 300, customerAccountId: mairie.id }]);
    const inv2 = await createInvoice(T.managerActor, mairie.id, {}, new Date(issued.getTime() + 86_400_000));
    expect(inv2.number).toBe(`FA-${year}-0002`);
    expect((await renderInvoicePdf(T.est.id, inv.id)).pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("règlements : les plus anciennes factures d'abord, retard, relance par e-mail, espèces en caisse", async () => {
    const [inv1] = await prisma.accountInvoice.findMany({ where: { accountId: mairie.id }, orderBy: { seq: "asc" } });
    await recordSettlement(T.managerActor, mairie.id, { amount: 5000, method: "CHECK", reference: "Chèque 0012345" });
    let a = await getAccount(T.est.id, mairie.id, new Date("2026-11-15T00:00:00Z"));
    expect(a.balance).toBe(3300);
    expect(a.invoices.map((i) => [i.number, i.paid, i.status])).toEqual([["FA-2026-0002", 0, "ISSUED"], ["FA-2026-0001", 5000, "ISSUED"]]);
    // Après l'échéance : en retard
    a = await getAccount(T.est.id, mairie.id, new Date("2026-12-15T00:00:00Z"));
    expect(a.invoices.find((i) => i.number === "FA-2026-0001")).toMatchObject({ status: "OVERDUE", remaining: 3000 });

    sentMails.length = 0;
    expect(await remindInvoice(T.managerActor, inv1.id)).toEqual({ sentTo: "compta@mairie.pf" });
    expect(sentMails[0].subject).toContain("FA-2026-0001");
    expect(sentMails[0].text.replace(/\s/g, " ")).toContain("Reste à régler : 3 000");
    expect(sentMails[0].attachments?.[0].filename).toBe("facture-FA-2026-0001.pdf");
    expect((await prisma.accountInvoice.findUniqueOrThrow({ where: { id: inv1.id } })).reminderCount).toBe(1);

    // Espèces : il faut une caisse ouverte, et le règlement entre dans le tiroir
    await expect(recordSettlement(T.managerActor, mairie.id, { amount: 3300, method: "CASH" })).rejects.toMatchObject({ code: "NO_CASH_SESSION" });
    const { session } = await openSession(T.managerActor, { openingFloat: 0 });
    await recordSettlement(T.managerActor, mairie.id, { amount: 3300, method: "CASH" });
    expect(await prisma.cashMovement.findFirst({ where: { cashSessionId: session.id, kind: "PAY_IN" } })).toMatchObject({ amount: 3300, reason: "Règlement compte Mairie de Punaauia" });
    a = await getAccount(T.est.id, mairie.id);
    expect(a.balance).toBe(0);
    expect(a.invoices.every((i) => i.status === "PAID")).toBe(true);
    await expect(remindInvoice(T.managerActor, inv1.id)).rejects.toMatchObject({ code: "INVOICE_PAID" });
    expect((await listAccounts(T.est.id)).find((x) => x.id === mairie.id)).toMatchObject({ balance: 0, uninvoiced: 0, overdue: 0 });
  });

  it("export comptable : consommations sur compte en 411, règlements au débit banque / caisse", async () => {
    const ex = await buildAccountingExport(T.est.id, "2020-01-01", "2030-12-31", "Pacific/Tahiti");
    const entries = ex.sheets.find((s) => s.name === "Écritures")!.rows;
    expect(entries.some((r) => r[1] === "VT" && r[2] === "411000")).toBe(true);
    expect(entries.filter((r) => r[1] === "RG" && r[2] === "411000").reduce((s, r) => s + Number(r[5]), 0)).toBe(8300);
    expect(entries.some((r) => r[1] === "RG" && r[2] === "512100" && r[4] === 5000)).toBe(true);
    expect(ex.sheets.some((s) => s.name === "Règlements clients")).toBe(true);
  });
});
