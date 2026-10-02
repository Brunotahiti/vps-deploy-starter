import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { prisma, type Tx } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { formatMoney } from "@/lib/money";
import { endOfLocalDay, localDay } from "@/lib/dates";
import { findOpenSession } from "./cash";
import { assertNotDemoEmail } from "./demo";
import type { Actor } from "./orders";

/**
 * Marketing & cartes cadeaux (option « marketing ») : cartes cadeaux (vente puis paiement GIFT_CARD, en une ou
 * plusieurs fois), campagnes d'e-mails aux seuls clients qui l'ont accepté (lien de désabonnement signé),
 * lien d'avis Google sur les reçus et affiche QR code.
 */

// ─── Cartes cadeaux ───

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans 0/O, 1/I/L : lisible au téléphone et sur papier
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(.{4})(?=.)/, "$1-");
function newCode() {
  const c = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

export type GiftCardSaleMethod = "CASH" | "CARD" | "CHECK" | "TRANSFER" | "OFFERED";
export const SALE_LABEL: Record<GiftCardSaleMethod, string> = { CASH: "Espèces", CARD: "Carte bancaire", CHECK: "Chèque", TRANSFER: "Virement", OFFERED: "Offerte" };

/** Vente d'une carte cadeau : l'argent est reçu maintenant (en espèces : dans la caisse ouverte), la TVA sera due à l'utilisation. */
export async function sellGiftCard(actor: Actor, input: { amount: number; method: GiftCardSaleMethod; reference?: string | null; buyerName?: string | null; recipientName?: string | null; message?: string | null; expiresOn?: string | null }, now = new Date()) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { timezone: true } });
  if (input.expiresOn && input.expiresOn <= localDay(now, est.timezone)) throw new ApiError(400, "BAD_DATE", "La date de validité doit être dans le futur");
  const session = input.method === "CASH" ? await findOpenSession(actor.establishmentId, actor.terminalId ?? null) : null;
  if (input.method === "CASH" && !session) throw new ApiError(409, "NO_CASH_SESSION", "Ouvrez une session de caisse pour encaisser une carte cadeau en espèces");
  const card = await prisma.$transaction(async (tx) => {
    let code = newCode();
    for (let i = 0; i < 5 && (await tx.giftCard.findUnique({ where: { code }, select: { id: true } })); i++) code = newCode();
    const c = await tx.giftCard.create({
      data: {
        establishmentId: actor.establishmentId, code, initialAmount: input.amount, balance: input.amount, buyerName: input.buyerName?.trim() || null, recipientName: input.recipientName?.trim() || null,
        message: input.message?.trim() || null, expiresAt: input.expiresOn ? endOfLocalDay(input.expiresOn, est.timezone) : null, saleMethod: input.method, saleReference: input.reference?.trim() || null,
        cashSessionId: session?.id ?? null, soldById: actor.userId, createdAt: now,
      },
    });
    if (session) await tx.cashMovement.create({ data: { cashSessionId: session.id, userId: actor.userId, kind: "PAY_IN", amount: input.amount, reason: `Carte cadeau ${code}` } });
    await audit({ ...actor, action: input.method === "OFFERED" ? "giftcard.offered" : "giftcard.sell", entityType: "gift_card", entityId: c.id, newValue: { code, amount: input.amount, method: input.method } }, tx);
    return c;
  });
  if (session) publish("cash.updated", actor.establishmentId, { cashSessionId: session.id });
  return card;
}

const cardView = (c: { id: string; code: string; initialAmount: number; balance: number; buyerName: string | null; recipientName: string | null; message: string | null; expiresAt: Date | null; status: string; saleMethod: string; createdAt: Date }, now: Date) => ({
  id: c.id, code: c.code, initialAmount: c.initialAmount, balance: c.balance, buyerName: c.buyerName, recipientName: c.recipientName, message: c.message,
  expiresAt: c.expiresAt?.toISOString() ?? null, expired: !!c.expiresAt && c.expiresAt < now, status: c.status as "ACTIVE" | "CANCELLED", saleMethod: c.saleMethod, createdAt: c.createdAt.toISOString(),
});

export async function listGiftCards(establishmentId: string, now = new Date()) {
  const rows = await prisma.giftCard.findMany({ where: { establishmentId }, orderBy: { createdAt: "desc" }, take: 500 });
  const cards = rows.map((c) => cardView(c, now));
  const live = cards.filter((c) => c.status === "ACTIVE" && !c.expired);
  return { cards, outstanding: live.reduce((s, c) => s + c.balance, 0), sold: cards.filter((c) => c.saleMethod !== "OFFERED").reduce((s, c) => s + c.initialAmount, 0) };
}

/** Carte cadeau d'après son code (caisse) : solde et validité. */
export async function lookupGiftCard(establishmentId: string, code: string, now = new Date()) {
  const c = await prisma.giftCard.findFirst({ where: { establishmentId, code: normalizeCode(code) } });
  if (!c) throw new ApiError(404, "GIFT_CARD_NOT_FOUND", "Carte cadeau introuvable : vérifiez le code");
  return cardView(c, now);
}

export async function getGiftCard(establishmentId: string, id: string) {
  const c = await prisma.giftCard.findFirst({ where: { id, establishmentId }, include: { establishment: { select: { name: true, phone: true, timezone: true, currency: true } } } });
  if (!c) throw new ApiError(404, "NOT_FOUND", "Carte cadeau introuvable");
  return c;
}

/** Annulation (carte perdue, vente annulée) : le solde restant n'est plus utilisable. */
export async function cancelGiftCard(actor: Actor, id: string, reason: string, now = new Date()) {
  const c = await prisma.giftCard.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!c) throw new ApiError(404, "NOT_FOUND", "Carte cadeau introuvable");
  if (c.status === "CANCELLED") return c;
  const upd = await prisma.giftCard.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason } });
  await audit({ ...actor, action: "giftcard.cancel", entityType: "gift_card", entityId: id, oldValue: { balance: c.balance }, reason });
  return upd;
}

/** Paiement par carte cadeau, dans la transaction d'encaissement : carte verrouillée, active, valide et solde suffisant. */
export async function debitGiftCard(tx: Tx, actor: Actor, code: string | null | undefined, amount: number, now = new Date()) {
  if (!code) throw new ApiError(400, "GIFT_CARD_REQUIRED", "Saisissez le code de la carte cadeau");
  const c = await tx.giftCard.findFirst({ where: { establishmentId: actor.establishmentId, code: normalizeCode(code) } });
  if (!c) throw new ApiError(404, "GIFT_CARD_NOT_FOUND", "Carte cadeau introuvable : vérifiez le code");
  await tx.$queryRaw`SELECT id FROM gift_cards WHERE id = ${c.id}::uuid FOR UPDATE`;
  const fresh = await tx.giftCard.findUniqueOrThrow({ where: { id: c.id } });
  if (fresh.status !== "ACTIVE") throw new ApiError(409, "GIFT_CARD_CANCELLED", `Carte cadeau ${fresh.code} annulée`);
  if (fresh.expiresAt && fresh.expiresAt < now) throw new ApiError(409, "GIFT_CARD_EXPIRED", `Carte cadeau ${fresh.code} expirée`);
  if (fresh.balance < amount) throw new ApiError(409, "GIFT_CARD_BALANCE", `Solde insuffisant sur la carte ${fresh.code} : ${formatMoney(fresh.balance)} disponible`, { balance: fresh.balance });
  await tx.giftCard.update({ where: { id: c.id }, data: { balance: { decrement: amount } } });
  return fresh;
}

/** Remboursement d'un paiement par carte cadeau : le montant revient sur la carte. */
export async function creditGiftCard(tx: Tx, giftCardId: string, amount: number) {
  await tx.giftCard.update({ where: { id: giftCardId }, data: { balance: { increment: amount } } });
}

export async function assertMarketingOption(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { options: true } });
  if (!org?.options.includes("marketing")) throw new ApiError(403, "OPTION_REQUIRED", "Option « Marketing & cartes cadeaux » à débloquer dans Gestion → Options", { option: "marketing" });
}

// ─── Campagnes ───

export type Segment = "ALL" | "INACTIVE" | "BIRTHDAY_MONTH" | "NEW";
export const SEGMENT_LABEL: Record<Segment, string> = { ALL: "Tous les clients inscrits", INACTIVE: "Clients qui ne sont pas revenus depuis 2 mois", BIRTHDAY_MONTH: "Anniversaires du mois", NEW: "Nouveaux clients (30 derniers jours)" };
const INACTIVE_DAYS = 60;
const MAX_RECIPIENTS = 2000;

/** Destinataires d'un segment : seulement les clients qui ont accepté, avec un e-mail, non désabonnés. */
export async function segmentRecipients(establishmentId: string, segment: Segment, now = new Date()) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { organizationId: true, timezone: true } });
  const base = { organizationId: est.organizationId, marketingConsent: true, unsubscribedAt: null, email: { not: null } };
  const select = { id: true, firstName: true, lastName: true, email: true } as const;
  if (segment === "ALL") return prisma.customer.findMany({ where: base, select, take: MAX_RECIPIENTS });
  if (segment === "NEW") return prisma.customer.findMany({ where: { ...base, createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }, select, take: MAX_RECIPIENTS });
  if (segment === "BIRTHDAY_MONTH") return prisma.customer.findMany({ where: { ...base, birthday: { startsWith: `${localDay(now, est.timezone).slice(5, 7)}-` } }, select, take: MAX_RECIPIENTS });
  // Inactifs : dernière commande réglée il y a plus de 2 mois (ou jamais venus depuis leur inscription il y a plus de 2 mois)
  const since = new Date(now.getTime() - INACTIVE_DAYS * 86_400_000);
  return prisma.customer.findMany({ where: { ...base, createdAt: { lt: since }, orders: { none: { status: "PAID", closedAt: { gte: since } } } }, select, take: MAX_RECIPIENTS });
}

export async function previewSegment(establishmentId: string, segment: Segment) {
  const list = await segmentRecipients(establishmentId, segment);
  return { segment, label: SEGMENT_LABEL[segment], count: list.length, sample: list.slice(0, 5).map((c) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email) };
}

const secret = () => process.env.SESSION_SECRET || "manaresto-dev-secret";
const sig = (customerId: string) => createHmac("sha256", secret()).update(`unsubscribe:${customerId}`).digest("base64url").slice(0, 22);
export const unsubscribeToken = (customerId: string) => `${customerId}.${sig(customerId)}`;
export function verifyUnsubscribeToken(token: string): string | null {
  const [id, s] = token.split(".");
  if (!id || !s || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = Buffer.from(sig(id)), got = Buffer.from(s);
  return expected.length === got.length && timingSafeEqual(expected, got) ? id : null;
}

/** Désabonnement depuis le lien d'un e-mail : définitif tant que le client ne redonne pas son accord. */
export async function unsubscribe(token: string, now = new Date()) {
  const id = verifyUnsubscribeToken(token);
  if (!id) throw new ApiError(400, "BAD_TOKEN", "Lien de désabonnement invalide");
  const c = await prisma.customer.findUnique({ where: { id }, select: { id: true, organization: { select: { name: true } } } });
  if (!c) throw new ApiError(404, "NOT_FOUND", "Lien de désabonnement invalide");
  await prisma.customer.update({ where: { id }, data: { unsubscribedAt: now, marketingConsent: false } });
  return { organization: c.organization.name };
}

/**
 * Envoi d'une campagne : enregistrée tout de suite, puis envoyée en arrière-plan (un e-mail à la fois, pour ménager
 * le serveur d'envoi). Le suivi (envoyés / échecs) se met à jour au fil de l'eau.
 */
export async function sendCampaign(actor: Actor, input: { name: string; segment: Segment; subject: string; body: string }, opts: { wait?: boolean } = {}) {
  await assertNotDemoEmail(actor.organizationId);
  const { isEmailConfigured, sendMail, campaignMail } = await import("@/server/email/mailer");
  if (!isEmailConfigured()) throw new ApiError(503, "EMAIL_NOT_CONFIGURED", "L'envoi d'e-mails n'est pas configuré sur ce serveur");
  const recipients = await segmentRecipients(actor.establishmentId, input.segment);
  if (!recipients.length) throw new ApiError(409, "NO_RECIPIENTS", "Aucun client inscrit dans ce segment (seuls les clients qui ont accepté de recevoir vos offres reçoivent les campagnes)");
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { name: true, phone: true, email: true, settings: true } });
  const campaign = await prisma.marketingCampaign.create({ data: { establishmentId: actor.establishmentId, name: input.name, segment: input.segment, subject: input.subject, body: input.body, recipients: recipients.length, createdById: actor.userId } });
  await audit({ ...actor, action: "marketing.campaign", entityType: "marketing_campaign", entityId: campaign.id, newValue: { name: input.name, segment: input.segment, recipients: recipients.length } });
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "") || "https://app.manaresto.com";
  const reviewUrl = ((est.settings ?? {}) as { marketing?: { reviewUrl?: string } }).marketing?.reviewUrl || null;
  const run = async () => {
    let sent = 0, failed = 0;
    for (const r of recipients) {
      try {
        await sendMail(campaignMail({ to: r.email!, establishmentName: est.name, firstName: r.firstName, subject: input.subject, body: input.body, phone: est.phone, replyTo: est.email, reviewUrl, unsubscribeUrl: `${base}/desabonnement/${unsubscribeToken(r.id)}` }));
        sent++;
      } catch { failed++; }
      if ((sent + failed) % 25 === 0) await prisma.marketingCampaign.update({ where: { id: campaign.id }, data: { sent, failed } });
    }
    await prisma.marketingCampaign.update({ where: { id: campaign.id }, data: { sent, failed, status: "SENT", finishedAt: new Date() } });
  };
  if (opts.wait) await run();
  else void run().catch((e) => console.error("[marketing] envoi de campagne interrompu", e));
  return campaign;
}

export async function listCampaigns(establishmentId: string) {
  return prisma.marketingCampaign.findMany({ where: { establishmentId }, orderBy: { createdAt: "desc" }, take: 100 });
}

// ─── Avis Google ───

export async function reviewSettings(establishmentId: string) {
  const e = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { settings: true } });
  return { reviewUrl: ((e.settings ?? {}) as { marketing?: { reviewUrl?: string } }).marketing?.reviewUrl ?? "" };
}

export async function saveReviewSettings(actor: Actor, reviewUrl: string | null) {
  const e = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { settings: true } });
  const settings = (e.settings ?? {}) as Record<string, unknown>;
  const marketing = { ...((settings.marketing as Record<string, unknown>) ?? {}), reviewUrl: reviewUrl || null };
  await prisma.establishment.update({ where: { id: actor.establishmentId }, data: { settings: { ...settings, marketing } } });
  await audit({ ...actor, action: "marketing.review_url", entityType: "establishment", entityId: actor.establishmentId, newValue: { reviewUrl: reviewUrl || null } });
  return { reviewUrl: reviewUrl || "" };
}

/** Lien d'avis à mettre sur les reçus : seulement si l'option est active et le lien renseigné. */
export async function reviewUrlFor(establishmentId: string): Promise<string | null> {
  const e = await prisma.establishment.findUnique({ where: { id: establishmentId }, select: { settings: true, organization: { select: { options: true } } } });
  if (!e?.organization.options.includes("marketing")) return null;
  return ((e.settings ?? {}) as { marketing?: { reviewUrl?: string } }).marketing?.reviewUrl || null;
}
