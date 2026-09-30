import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { addItem, createOrder } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { openSession } from "@/server/services/cash";
import { renderReceiptPdfElegant } from "@/server/receipts/pdf-elegant";
import { renderReceiptPdf, renderReceiptHtml } from "@/server/receipts/receipt";
import { emailReceipt } from "@/server/services/receipt-email";
import { sentMails } from "@/server/email/mailer";
import { prisma } from "@/server/db";

let T: Awaited<ReturnType<typeof makeTenant>>;
let orderId: string;

beforeAll(async () => {
  process.env.EMAIL_TRANSPORT = "memory";
  await resetDb();
  T = await makeTenant("receipt");
  const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 2 });
  orderId = o.id;
  await addItem(T.actor, orderId, { productId: T.burger.id, quantity: 2, modifiers: [{ modifierId: T.cuisson.modifiers[0].id }, { modifierId: T.supp.modifiers[0].id }], notes: "sans oignons" });
  await addItem(T.actor, orderId, { productId: T.biere.id });
  await openSession(T.managerActor, { openingFloat: 10000 });
  const r = await addPayments(T.actor, orderId, [{ method: "CASH", amount: 5000, tendered: 5000 }, { method: "CARD", amount: 300 }]);
  expect(r.order.status).toBe("PAID");
});

describe("reçus", () => {
  it("génère un reçu PDF élégant (A5) et le ticket thermique", async () => {
    const pdf = await renderReceiptPdfElegant(T.est.id, orderId);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(2500);
    const thermal = await renderReceiptPdf(T.est.id, orderId);
    expect(thermal.subarray(0, 5).toString()).toBe("%PDF-");
    const html = await renderReceiptHtml(T.est.id, orderId);
    expect(html).toContain("Merci de votre visite");
    expect(html).toContain("TOTAL TTC");
  });

  it("envoie le reçu par e-mail avec le PDF en pièce jointe et trace l'envoi", async () => {
    const before = sentMails.length;
    const r = await emailReceipt(T.actor, orderId, "client@exemple.pf");
    expect(r.sent).toBe(true);
    expect(sentMails.length).toBe(before + 1);
    const mail = sentMails[sentMails.length - 1];
    expect(mail.to).toBe("client@exemple.pf");
    expect(mail.subject).toContain("Votre reçu");
    expect(mail.subject).toContain(T.est.name);
    expect(mail.attachments?.[0].filename).toMatch(/^recu-.*\.pdf$/);
    expect(mail.attachments?.[0].content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(mail.html).toContain("5 300");
    const log = await prisma.auditLog.findFirst({ where: { action: "receipt.email", entityId: orderId } });
    expect(log).not.toBeNull();
  });

  it("refuse une commande d'un autre établissement et une commande annulée", async () => {
    const other = await makeTenant("receipt-other");
    await expect(emailReceipt(other.actor, orderId, "x@y.pf")).rejects.toMatchObject({ status: 404 });
  });

  it("signale clairement l'absence de configuration SMTP", async () => {
    const saved = process.env.EMAIL_TRANSPORT;
    delete process.env.EMAIL_TRANSPORT;
    delete process.env.SMTP_HOST;
    await expect(emailReceipt(T.actor, orderId, "x@y.pf")).rejects.toMatchObject({ code: "EMAIL_NOT_CONFIGURED" });
    process.env.EMAIL_TRANSPORT = saved;
  });
});
