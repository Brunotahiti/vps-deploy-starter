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
import { upsertCustomer } from "@/server/services/customers";
import { emailReceipt } from "@/server/services/receipt-email";
import { buildAccountingExport } from "@/server/reports/export";
import {
  cancelGiftCard, listGiftCards, lookupGiftCard, normalizeCode, previewSegment, saveReviewSettings, sellGiftCard, sendCampaign, unsubscribe, unsubscribeToken, verifyUnsubscribeToken,
} from "@/server/services/marketing";

let T: Awaited<ReturnType<typeof makeTenant>>;

/** Commande de 2 salades et 1 bière : 3 000 F */
async function meal() {
  const o = await createOrder(T.actor, { type: "COUNTER" });
  await addItem(T.actor, o.id, { productId: T.entree.id, quantity: 2 });
  await addItem(T.actor, o.id, { productId: T.biere.id });
  return o;
}

beforeAll(async () => {
  process.env.EMAIL_TRANSPORT = "memory";
  await resetDb();
  T = await makeTenant("marketing");
});

describe("Marketing & cartes cadeaux", () => {
  it("option et droits", () => {
    expect(lockedPermissions(["stock"]).has("giftcards.sell")).toBe(true);
    expect(lockedPermissions(["marketing"]).has("marketing.manage")).toBe(false);
    expect(SYSTEM_ROLES.cashier.permissions).toContain("giftcards.sell");
    expect(SYSTEM_ROLES.manager.permissions).toEqual(expect.arrayContaining(["giftcards.sell", "marketing.manage"]));
    expect(normalizeCode("abcd efgh")).toBe("ABCD-EFGH");
  });

  it("vente : en espèces dans la caisse ouverte, code lisible, carte imprimable", async () => {
    await expect(sellGiftCard(T.managerActor, { amount: 5000, method: "CASH" })).rejects.toMatchObject({ code: "NO_CASH_SESSION" });
    const { session } = await openSession(T.managerActor, { openingFloat: 0 });
    const card = await sellGiftCard(T.managerActor, { amount: 5000, method: "CASH", buyerName: "Hina", recipientName: "Teva", message: "Joyeux anniversaire" });
    expect(card.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(card).toMatchObject({ initialAmount: 5000, balance: 5000, status: "ACTIVE" });
    expect(await prisma.cashMovement.findFirst({ where: { cashSessionId: session.id, kind: "PAY_IN" } })).toMatchObject({ amount: 5000, reason: `Carte cadeau ${card.code}` });
    await sellGiftCard(T.managerActor, { amount: 3000, method: "CARD", reference: "TPE 4421" });
    await expect(sellGiftCard(T.managerActor, { amount: 3000, method: "CARD", expiresOn: "2020-01-01" })).rejects.toMatchObject({ code: "BAD_DATE" });
    const list = await listGiftCards(T.est.id);
    expect(list).toMatchObject({ outstanding: 8000, sold: 8000 });
  });

  it("paiement par carte cadeau : en une ou plusieurs fois, solde vérifié, remboursement recrédité", async () => {
    const { cards } = await listGiftCards(T.est.id);
    const card = cards.find((c) => c.initialAmount === 5000)!;
    const code = card.code.toLowerCase().replace("-", " "); // tapé à la main
    const o1 = await meal();
    const r1 = await addPayments(T.actor, o1.id, [{ method: "GIFT_CARD", amount: 3000, giftCardCode: code }]);
    expect(r1.order.status).toBe("PAID");
    expect(r1.payments[0]).toMatchObject({ method: "GIFT_CARD", giftCardId: card.id, reference: card.code });
    expect((await lookupGiftCard(T.est.id, card.code)).balance).toBe(2000);
    // Solde insuffisant : refusé ; complété en espèces
    const o2 = await meal();
    await expect(addPayments(T.actor, o2.id, [{ method: "GIFT_CARD", amount: 3000, giftCardCode: card.code }])).rejects.toMatchObject({ code: "GIFT_CARD_BALANCE" });
    await addPayments(T.actor, o2.id, [{ method: "GIFT_CARD", amount: 2000, giftCardCode: card.code }, { method: "CASH", amount: 1000 }]);
    expect((await lookupGiftCard(T.est.id, card.code)).balance).toBe(0);
    await expect(addPayments(T.actor, (await meal()).id, [{ method: "GIFT_CARD", amount: 100 }])).rejects.toMatchObject({ code: "GIFT_CARD_REQUIRED" });
    await expect(addPayments(T.actor, (await meal()).id, [{ method: "GIFT_CARD", amount: 100, giftCardCode: "ZZZZ-ZZZZ" }])).rejects.toMatchObject({ code: "GIFT_CARD_NOT_FOUND" });
    // Remboursement : le montant revient sur la carte
    await refundPayment(T.managerActor, r1.payments[0].id, { amount: 1000, reason: "Plat refusé" });
    expect((await lookupGiftCard(T.est.id, card.code)).balance).toBe(1000);
  });

  it("carte expirée ou annulée : refusée ; sans l'option : refusée", async () => {
    const { cards } = await listGiftCards(T.est.id);
    const card = cards.find((c) => c.initialAmount === 3000)!;
    await prisma.giftCard.update({ where: { id: card.id }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
    await expect(addPayments(T.actor, (await meal()).id, [{ method: "GIFT_CARD", amount: 1000, giftCardCode: card.code }])).rejects.toMatchObject({ code: "GIFT_CARD_EXPIRED" });
    await prisma.giftCard.update({ where: { id: card.id }, data: { expiresAt: null } });
    await cancelGiftCard(T.managerActor, card.id, "Carte perdue");
    await expect(addPayments(T.actor, (await meal()).id, [{ method: "GIFT_CARD", amount: 1000, giftCardCode: card.code }])).rejects.toMatchObject({ code: "GIFT_CARD_CANCELLED" });
    const other = await makeTenant("marketing-sans", { options: ["stock"] });
    const o = await createOrder(other.actor, { type: "COUNTER" });
    await addItem(other.actor, o.id, { productId: other.eau.id });
    await expect(addPayments(other.actor, o.id, [{ method: "GIFT_CARD", amount: 300, giftCardCode: card.code }])).rejects.toMatchObject({ code: "OPTION_REQUIRED" });
  });

  it("campagnes : seulement les clients qui l'ont accepté, segments, lien de désabonnement", async () => {
    const day = new Date();
    const month = String(day.getUTCMonth() + 1).padStart(2, "0");
    const a = await upsertCustomer(T.managerActor, { firstName: "Moana", email: "moana@exemple.pf", marketingConsent: true, birthday: `${month}-15` });
    await upsertCustomer(T.managerActor, { firstName: "Sans accord", email: "non@exemple.pf" });
    const old = await upsertCustomer(T.managerActor, { firstName: "Ancien", email: "ancien@exemple.pf", marketingConsent: true });
    await prisma.customer.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 120 * 86_400_000) } });
    expect((await previewSegment(T.est.id, "ALL")).count).toBe(2);
    expect((await previewSegment(T.est.id, "BIRTHDAY_MONTH")).sample).toEqual(["Moana"]);
    expect((await previewSegment(T.est.id, "INACTIVE")).sample).toEqual(["Ancien"]);
    expect((await previewSegment(T.est.id, "NEW")).sample).toEqual(["Moana"]);

    await saveReviewSettings(T.managerActor, "https://g.page/r/exemple/review");
    sentMails.length = 0;
    const c = await sendCampaign(T.managerActor, { name: "Soirée tamure", segment: "ALL", subject: "Soirée spéciale vendredi", body: "Venez nombreux !\n\nRéservez votre table." }, { wait: true });
    expect(c.recipients).toBe(2);
    expect((await prisma.marketingCampaign.findUniqueOrThrow({ where: { id: c.id } }))).toMatchObject({ status: "SENT", sent: 2, failed: 0 });
    expect(sentMails.map((m) => m.to).sort()).toEqual(["ancien@exemple.pf", "moana@exemple.pf"]);
    const mail = sentMails.find((m) => m.to === "moana@exemple.pf")!;
    expect(mail.html).toContain("Ia ora na Moana");
    expect(mail.html).toContain("https://g.page/r/exemple/review");
    expect(mail.text).toContain(`/desabonnement/${unsubscribeToken(a.id)}`);

    // Désabonnement : jeton signé, plus de campagne pour ce client
    expect(verifyUnsubscribeToken(`${a.id}.faux`)).toBeNull();
    await expect(unsubscribe("pas-un-jeton-valide")).rejects.toMatchObject({ code: "BAD_TOKEN" });
    await unsubscribe(unsubscribeToken(a.id));
    expect((await previewSegment(T.est.id, "ALL")).count).toBe(1);
    // Redonner son accord sur place annule le désabonnement
    await upsertCustomer(T.managerActor, { id: a.id, firstName: "Moana", email: "moana@exemple.pf", marketingConsent: true });
    expect((await previewSegment(T.est.id, "ALL")).count).toBe(2);
  });

  it("reçu par e-mail : bouton « Donnez-nous votre avis » si le lien est renseigné", async () => {
    const o = await meal();
    await addPayments(T.actor, o.id, [{ method: "CARD", amount: 3000 }]);
    sentMails.length = 0;
    await emailReceipt(T.actor, o.id, "client@exemple.pf");
    expect(sentMails[0].html).toContain("Donnez-nous votre avis");
    expect(sentMails[0].html).toContain("https://g.page/r/exemple/review");
  });

  it("export comptable : cartes vendues en 419 (avances clients), utilisées comme moyen de paiement", async () => {
    const ex = await buildAccountingExport(T.est.id, "2020-01-01", "2030-12-31", "Pacific/Tahiti");
    const entries = ex.sheets.find((s) => s.name === "Écritures")!.rows;
    expect(entries.filter((r) => r[1] === "CC" && r[2] === "419100").reduce((s, r) => s + Number(r[5]), 0)).toBe(8000);
    expect(entries.some((r) => r[1] === "VT" && r[2] === "419100")).toBe(true);
    expect(ex.sheets.some((s) => s.name === "Cartes cadeaux vendues")).toBe(true);
  });
});
