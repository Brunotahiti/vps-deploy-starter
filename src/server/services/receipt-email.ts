import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/dates";
import { isEmailConfigured, receiptMail, sendMail } from "@/server/email/mailer";
import { assertNotDemoEmail } from "./demo";
import { renderReceiptPdfElegant } from "@/server/receipts/pdf-elegant";
import type { Actor } from "./orders";

/** Envoie le reçu PDF d'une commande à l'adresse indiquée et trace l'envoi. */
export async function emailReceipt(actor: Actor, orderId: string, to: string) {
  if (!isEmailConfigured()) throw new ApiError(503, "EMAIL_NOT_CONFIGURED", "L'envoi d'e-mails n'est pas configuré (variables SMTP_* du serveur)");
  await assertNotDemoEmail(actor.organizationId);
  const order = await prisma.order.findFirst({ where: { id: orderId, establishmentId: actor.establishmentId }, include: { establishment: true } });
  if (!order) throw new ApiError(404, "NOT_FOUND", "Commande introuvable");
  if (order.status === "CANCELLED") throw new ApiError(409, "ORDER_CANCELLED", "Commande annulée");
  const est = order.establishment;
  const pdf = await renderReceiptPdfElegant(actor.establishmentId, orderId);
  const mail = receiptMail({
    to, establishmentName: est.name, orderNumber: order.number, total: formatMoney(order.total, est.currency), dateLabel: formatDateTime(order.closedAt ?? order.openedAt, est.timezone), pdf,
    isPaid: order.status === "PAID", phone: est.phone, address: [est.addressLine1, [est.postalCode, est.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
  });
  let result: { id: string };
  try {
    result = await sendMail(mail);
  } catch (e) {
    throw new ApiError(502, "EMAIL_FAILED", `Envoi impossible : ${e instanceof Error ? e.message : "erreur SMTP"}`);
  }
  // Mémoriser l'e-mail sur la fiche client si la commande y est rattachée et qu'elle n'en a pas
  if (order.customerId) await prisma.customer.updateMany({ where: { id: order.customerId, email: null }, data: { email: to } });
  await audit({ ...actor, action: "receipt.email", entityType: "order", entityId: orderId, newValue: { to, orderNumber: order.number, messageId: result.id } });
  return { sent: true, to, messageId: result.id };
}
