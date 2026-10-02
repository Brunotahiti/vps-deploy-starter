import { randomBytes } from "node:crypto";
import { prisma, type Tx } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { formatMoney } from "@/lib/money";
import { addDays, endOfLocalDay, formatDate, formatTime, localDay, startOfLocalDay } from "@/lib/dates";
import { CATERING_METHODS, EVENT_KINDS, eventTotals, paidOf, type CateringMethod, type EventKind, type EventLine, type EventStatus, type EventTaxRow } from "@/lib/catering";
import { findOpenSession } from "./cash";
import { assertNotDemoEmail } from "./demo";
import type { Actor } from "./orders";

/**
 * Traiteur & événements (option « catering ») : un événement (buffet, mariage, privatisation, repas d'entreprise)
 * suit le parcours devis → envoyé → confirmé (accepté en ligne ou sur papier) → facturé, avec acomptes et solde.
 * Devis (DV-) et factures (FT-) ont chacun leur numérotation continue par établissement et par année.
 */

const newToken = () => randomBytes(18).toString("base64url");
const LOCKED: EventStatus[] = ["INVOICED", "CANCELLED"];

export type EventInput = {
  title: string; kind: EventKind; startsAt: string; endsAt: string; guests: number; location?: string | null; privatize?: boolean;
  clientName: string; clientCompany?: string | null; clientTahitiNumber?: string | null; clientEmail?: string | null; clientPhone?: string | null; clientAddress?: string | null;
  lines?: EventLine[]; depositAmount?: number; quoteNotes?: string | null; kitchenNotes?: string | null; internalNotes?: string | null;
};

const trim = (s: string | null | undefined) => s?.trim() || null;

function checkTimes(startsAt: Date, endsAt: Date) {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new ApiError(400, "BAD_DATE", "Date ou heure invalide");
  if (endsAt <= startsAt) throw new ApiError(400, "BAD_DATE", "L'heure de fin doit suivre l'heure de début");
  if (endsAt.getTime() - startsAt.getTime() > 3 * 86_400_000) throw new ApiError(400, "BAD_DATE", "Un événement dure 3 jours au plus");
}

function cleanLines(lines: EventLine[]) {
  return lines.map((l) => ({ label: l.label.trim(), quantity: l.quantity, unitPrice: l.unitPrice, taxRateBps: l.taxRateBps, taxRateName: trim(l.taxRateName) })).filter((l) => l.label);
}

async function findEvent(establishmentId: string, id: string) {
  const e = await prisma.cateringEvent.findFirst({ where: { id, establishmentId }, include: { payments: { orderBy: { receivedAt: "asc" } } } });
  if (!e) throw new ApiError(404, "NOT_FOUND", "Événement introuvable");
  return e;
}

type EventRow = Awaited<ReturnType<typeof findEvent>>;

function view(e: EventRow) {
  const paid = paidOf(e.payments);
  const lines = e.lines as unknown as EventLine[];
  return {
    id: e.id, title: e.title, kind: e.kind as EventKind, status: e.status as EventStatus, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), guests: e.guests,
    location: e.location, privatize: e.privatize, clientName: e.clientName, clientCompany: e.clientCompany, clientTahitiNumber: e.clientTahitiNumber, clientEmail: e.clientEmail,
    clientPhone: e.clientPhone, clientAddress: e.clientAddress, lines, ...eventTotals(lines), depositAmount: e.depositAmount, quoteNotes: e.quoteNotes, kitchenNotes: e.kitchenNotes,
    internalNotes: e.internalNotes, quoteNumber: e.quoteNumber, quoteSentAt: e.quoteSentAt?.toISOString() ?? null, validUntil: e.validUntil?.toISOString() ?? null,
    publicToken: e.publicToken, acceptedAt: e.acceptedAt?.toISOString() ?? null, acceptedBy: e.acceptedBy, invoiceNumber: e.invoiceNumber, invoicedAt: e.invoicedAt?.toISOString() ?? null,
    invoiceDueAt: e.invoiceDueAt?.toISOString() ?? null, cancelledAt: e.cancelledAt?.toISOString() ?? null, cancelReason: e.cancelReason,
    payments: e.payments.map((p) => ({ id: p.id, kind: p.kind, amount: p.amount, method: p.method as CateringMethod, reference: p.reference, receivedAt: p.receivedAt.toISOString() })),
    paid, remaining: Math.max(0, e.totalTtc - paid), depositDue: Math.max(0, e.depositAmount - paid),
  };
}
export type EventView = ReturnType<typeof view>;

// ─── Planning ───

/** Planning : événements d'une période (par défaut : d'aujourd'hui à 6 mois), les plus proches d'abord. */
export async function listEvents(establishmentId: string, timezone: string, opts: { from?: string; to?: string } = {}) {
  const from = opts.from ?? localDay(new Date(), timezone);
  const to = opts.to ?? addDays(from, 183);
  const rows = await prisma.cateringEvent.findMany({
    where: { establishmentId, startsAt: { gte: startOfLocalDay(from, timezone), lt: endOfLocalDay(to, timezone) } },
    orderBy: { startsAt: "asc" }, take: 500, include: { payments: { select: { kind: true, amount: true } } },
  });
  return rows.map((e) => {
    const paid = paidOf(e.payments);
    return {
      id: e.id, title: e.title, kind: e.kind as EventKind, status: e.status as EventStatus, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), guests: e.guests,
      location: e.location, privatize: e.privatize, clientName: e.clientName, clientCompany: e.clientCompany, totalTtc: e.totalTtc, depositAmount: e.depositAmount, paid,
      quoteNumber: e.quoteNumber, invoiceNumber: e.invoiceNumber, validUntil: e.validUntil?.toISOString() ?? null,
    };
  });
}

/** Planning sans montants (cuisine, salle) : quoi, quand, combien de personnes. */
export async function listEventsLite(establishmentId: string, timezone: string, opts: { from?: string; to?: string } = {}) {
  return (await listEvents(establishmentId, timezone, opts)).filter((e) => e.status !== "CANCELLED")
    .map((e) => ({ id: e.id, title: e.title, kind: e.kind, status: e.status, startsAt: e.startsAt, endsAt: e.endsAt, guests: e.guests, location: e.location, privatize: e.privatize }));
}

export async function getEvent(establishmentId: string, id: string) {
  return view(await findEvent(establishmentId, id));
}

/** De quoi composer un devis : les plats actifs de la carte et les taux de TVA. */
export async function quoteCatalog(establishmentId: string) {
  const [products, taxRates] = await Promise.all([
    prisma.product.findMany({ where: { establishmentId, isActive: true }, orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }], take: 1000, select: { id: true, name: true, priceTtc: true, category: { select: { name: true } }, taxRate: { select: { rateBps: true, name: true } } } }),
    prisma.taxRate.findMany({ where: { establishmentId, isActive: true }, orderBy: [{ isDefault: "desc" }, { rateBps: "asc" }], select: { name: true, rateBps: true, isDefault: true } }),
  ]);
  return {
    products: products.map((p) => ({ id: p.id, name: p.name, category: p.category?.name ?? null, priceTtc: p.priceTtc, taxRateBps: p.taxRate?.rateBps ?? taxRates.find((t) => t.isDefault)?.rateBps ?? 0, taxRateName: p.taxRate?.name ?? taxRates.find((t) => t.isDefault)?.name ?? null })),
    taxRates,
  };
}

// ─── Création, modification ───

export async function createEvent(actor: Actor, input: EventInput) {
  const startsAt = new Date(input.startsAt), endsAt = new Date(input.endsAt);
  checkTimes(startsAt, endsAt);
  const lines = cleanLines(input.lines ?? []);
  const t = eventTotals(lines);
  const deposit = input.depositAmount ?? 0;
  if (t.totalTtc > 0 && deposit > t.totalTtc) throw new ApiError(400, "BAD_DEPOSIT", "L'acompte dépasse le total du devis");
  const e = await prisma.cateringEvent.create({
    data: {
      establishmentId: actor.establishmentId, title: input.title.trim(), kind: input.kind, startsAt, endsAt, guests: input.guests, location: trim(input.location), privatize: input.privatize ?? false,
      clientName: input.clientName.trim(), clientCompany: trim(input.clientCompany), clientTahitiNumber: trim(input.clientTahitiNumber), clientEmail: trim(input.clientEmail), clientPhone: trim(input.clientPhone),
      clientAddress: trim(input.clientAddress), lines, totalTtc: t.totalTtc, totalTax: t.totalTax, depositAmount: deposit,
      quoteNotes: trim(input.quoteNotes), kitchenNotes: trim(input.kitchenNotes), internalNotes: trim(input.internalNotes), publicToken: newToken(), createdById: actor.userId,
    },
  });
  await audit({ ...actor, action: "catering.create", entityType: "catering_event", entityId: e.id, newValue: { title: e.title, startsAt: e.startsAt, guests: e.guests } });
  return getEvent(actor.establishmentId, e.id);
}

/**
 * Modification : un devis déjà envoyé dont le contenu change redevient « à envoyer » (le client doit voir la
 * nouvelle version avant de l'accepter). Un événement confirmé reste confirmé (nombre d'invités ajusté…) ;
 * facturé ou annulé, il ne bouge plus.
 */
export async function updateEvent(actor: Actor, id: string, input: Partial<EventInput>) {
  const old = await findEvent(actor.establishmentId, id);
  if (LOCKED.includes(old.status as EventStatus)) throw new ApiError(409, "EVENT_LOCKED", old.status === "INVOICED" ? "Événement facturé : il ne se modifie plus" : "Événement annulé : il ne se modifie plus");
  const startsAt = input.startsAt ? new Date(input.startsAt) : old.startsAt, endsAt = input.endsAt ? new Date(input.endsAt) : old.endsAt;
  checkTimes(startsAt, endsAt);
  const lines = input.lines ? cleanLines(input.lines) : (old.lines as unknown as EventLine[]);
  const t = eventTotals(lines);
  const deposit = input.depositAmount ?? old.depositAmount;
  if (t.totalTtc > 0 && deposit > t.totalTtc) throw new ApiError(400, "BAD_DEPOSIT", "L'acompte dépasse le total du devis");
  const content = JSON.stringify([lines, deposit, startsAt.getTime(), endsAt.getTime(), input.guests ?? old.guests, trim(input.location ?? old.location), trim(input.quoteNotes ?? old.quoteNotes)]);
  const before = JSON.stringify([old.lines, old.depositAmount, old.startsAt.getTime(), old.endsAt.getTime(), old.guests, old.location, old.quoteNotes]);
  const backToDraft = old.status === "SENT" && content !== before;
  await prisma.cateringEvent.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}), ...(input.kind !== undefined ? { kind: input.kind } : {}), startsAt, endsAt,
      ...(input.guests !== undefined ? { guests: input.guests } : {}), ...(input.location !== undefined ? { location: trim(input.location) } : {}), ...(input.privatize !== undefined ? { privatize: input.privatize } : {}),
      ...(input.clientName !== undefined ? { clientName: input.clientName.trim() } : {}), ...(input.clientCompany !== undefined ? { clientCompany: trim(input.clientCompany) } : {}),
      ...(input.clientTahitiNumber !== undefined ? { clientTahitiNumber: trim(input.clientTahitiNumber) } : {}), ...(input.clientEmail !== undefined ? { clientEmail: trim(input.clientEmail) } : {}),
      ...(input.clientPhone !== undefined ? { clientPhone: trim(input.clientPhone) } : {}), ...(input.clientAddress !== undefined ? { clientAddress: trim(input.clientAddress) } : {}),
      lines, totalTtc: t.totalTtc, totalTax: t.totalTax, depositAmount: deposit,
      ...(input.quoteNotes !== undefined ? { quoteNotes: trim(input.quoteNotes) } : {}), ...(input.kitchenNotes !== undefined ? { kitchenNotes: trim(input.kitchenNotes) } : {}),
      ...(input.internalNotes !== undefined ? { internalNotes: trim(input.internalNotes) } : {}),
      ...(backToDraft ? { status: "DRAFT", validUntil: null } : {}),
    },
  });
  await audit({ ...actor, action: "catering.update", entityType: "catering_event", entityId: id, oldValue: { totalTtc: old.totalTtc, guests: old.guests, status: old.status }, newValue: { totalTtc: t.totalTtc, guests: input.guests ?? old.guests, status: backToDraft ? "DRAFT" : old.status } });
  return getEvent(actor.establishmentId, id);
}

/** Suppression : seulement un brouillon jamais numéroté ni payé ; sinon on l'annule (l'historique reste). */
export async function deleteEvent(actor: Actor, id: string) {
  const e = await findEvent(actor.establishmentId, id);
  if (e.quoteNumber || e.payments.length) throw new ApiError(409, "EVENT_NUMBERED", "Ce devis a déjà un numéro ou un paiement : annulez l'événement plutôt que de le supprimer");
  await prisma.cateringEvent.delete({ where: { id } });
  await audit({ ...actor, action: "catering.delete", entityType: "catering_event", entityId: id, oldValue: { title: e.title } });
  return { ok: true };
}

export async function cancelEvent(actor: Actor, id: string, reason: string) {
  const e = await findEvent(actor.establishmentId, id);
  if (e.status === "INVOICED") throw new ApiError(409, "EVENT_LOCKED", "Événement déjà facturé : il ne peut plus être annulé");
  if (e.status === "CANCELLED") return getEvent(actor.establishmentId, id);
  await prisma.cateringEvent.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason.trim() } });
  await audit({ ...actor, action: "catering.cancel", entityType: "catering_event", entityId: id, newValue: { reason, paid: paidOf(e.payments) } });
  return getEvent(actor.establishmentId, id);
}

// ─── Devis : numéro, envoi, acceptation ───

/** Numéro suivant d'une série (DV devis, FT factures), sous verrou : continu, sans trou ni doublon. */
async function nextNumber(tx: Tx, establishmentId: string, series: "DV" | "FT", year: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catering:${series}:${establishmentId}`}))`;
  const last = series === "DV"
    ? await tx.cateringEvent.findFirst({ where: { establishmentId, quoteYear: year }, orderBy: { quoteSeq: "desc" }, select: { quoteSeq: true } }).then((r) => r?.quoteSeq ?? 0)
    : await tx.cateringEvent.findFirst({ where: { establishmentId, invoiceYear: year }, orderBy: { invoiceSeq: "desc" }, select: { invoiceSeq: true } }).then((r) => r?.invoiceSeq ?? 0);
  const seq = last + 1;
  return { seq, number: `${series}-${year}-${String(seq).padStart(4, "0")}` };
}

const publicBase = () => process.env.PUBLIC_URL?.replace(/\/$/, "") || "https://app.manaresto.com";
export const quoteUrl = (token: string) => `${publicBase()}/devis/${token}`;

/**
 * Envoi du devis : numéro attribué au premier envoi (conservé ensuite), validité de N jours. Par e-mail (PDF joint
 * et lien pour l'accepter en ligne) ou simplement marqué « envoyé » s'il a été remis en main propre.
 */
export async function sendQuote(actor: Actor, id: string, opts: { email: boolean; validityDays?: number }, now = new Date()) {
  const e = await findEvent(actor.establishmentId, id);
  if (LOCKED.includes(e.status as EventStatus) || e.status === "ACCEPTED") throw new ApiError(409, "BAD_STATUS", "Ce devis est déjà confirmé, facturé ou annulé");
  if (!(e.lines as unknown as EventLine[]).length || e.totalTtc <= 0) throw new ApiError(400, "EMPTY_QUOTE", "Ajoutez au moins une ligne avec un prix avant d'envoyer le devis");
  if (opts.email) {
    if (!e.clientEmail) throw new ApiError(400, "NO_EMAIL", "Ajoutez l'e-mail du client pour lui envoyer le devis");
    await assertNotDemoEmail(actor.organizationId); // restaurant exemple : jamais d'e-mail réel
    const { isEmailConfigured } = await import("@/server/email/mailer");
    if (!isEmailConfigured()) throw new ApiError(503, "EMAIL_NOT_CONFIGURED", "L'envoi d'e-mails n'est pas configuré sur ce serveur");
  }
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { timezone: true } });
  const validUntil = endOfLocalDay(addDays(localDay(now, est.timezone), opts.validityDays ?? 30), est.timezone);
  await prisma.$transaction(async (tx) => {
    const numbering = e.quoteNumber ? null : await nextNumber(tx, actor.establishmentId, "DV", Number(localDay(now, est.timezone).slice(0, 4)));
    await tx.cateringEvent.update({ where: { id }, data: { status: "SENT", quoteSentAt: now, validUntil, ...(numbering ? { quoteNumber: numbering.number, quoteYear: Number(numbering.number.slice(3, 7)), quoteSeq: numbering.seq } : {}) } });
  });
  const fresh = await getEvent(actor.establishmentId, id);
  if (opts.email) {
    const { sendMail, quoteMail } = await import("@/server/email/mailer");
    const { pdf } = await renderEventPdf(actor.establishmentId, id, "quote");
    const full = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { name: true, legalName: true, phone: true, email: true, timezone: true, currency: true } });
    await sendMail(quoteMail({
      to: fresh.clientEmail!, establishmentName: full.legalName || full.name, clientName: fresh.clientName, number: fresh.quoteNumber!, title: fresh.title,
      date: `${formatDate(fresh.startsAt, full.timezone)} à ${formatTime(fresh.startsAt, full.timezone)}`, guests: fresh.guests, total: formatMoney(fresh.totalTtc, full.currency),
      deposit: fresh.depositAmount ? formatMoney(fresh.depositAmount, full.currency) : null, validUntil: formatDate(validUntil, full.timezone), acceptUrl: quoteUrl(fresh.publicToken),
      phone: full.phone, replyTo: full.email, pdf,
    }));
  }
  await audit({ ...actor, action: "catering.quote_sent", entityType: "catering_event", entityId: id, newValue: { number: fresh.quoteNumber, email: opts.email ? fresh.clientEmail : null, totalTtc: fresh.totalTtc } });
  return fresh;
}

/** Confirmation par le restaurant (devis signé sur papier, accord par téléphone). */
export async function acceptQuote(actor: Actor, id: string, now = new Date()) {
  const e = await findEvent(actor.establishmentId, id);
  if (!["DRAFT", "SENT"].includes(e.status)) throw new ApiError(409, "BAD_STATUS", "Ce devis est déjà confirmé, facturé ou annulé");
  if (!e.quoteNumber) throw new ApiError(409, "QUOTE_NOT_SENT", "Envoyez ou remettez d'abord le devis au client (il reçoit ainsi son numéro)");
  await prisma.cateringEvent.update({ where: { id }, data: { status: "ACCEPTED", acceptedAt: now, acceptedBy: null } });
  await audit({ ...actor, action: "catering.accept", entityType: "catering_event", entityId: id, newValue: { number: e.quoteNumber, by: "restaurant" } });
  return getEvent(actor.establishmentId, id);
}

/** Devis vu par le client (lien secret) : le contenu, sans les notes internes. */
export async function publicQuote(token: string, now = new Date()) {
  const e = await prisma.cateringEvent.findUnique({ where: { publicToken: token }, include: { establishment: { select: { name: true, legalName: true, phone: true, email: true, timezone: true, currency: true, organization: { select: { options: true } } } } } });
  if (!e || !e.quoteNumber || !e.establishment.organization.options.includes("catering")) throw new ApiError(404, "NOT_FOUND", "Devis introuvable");
  const lines = e.lines as unknown as EventLine[];
  const expired = e.status === "SENT" && !!e.validUntil && e.validUntil < now;
  return {
    establishment: { name: e.establishment.name, legalName: e.establishment.legalName, phone: e.establishment.phone, email: e.establishment.email, timezone: e.establishment.timezone, currency: e.establishment.currency },
    number: e.quoteNumber, title: e.title, kind: EVENT_KINDS[e.kind as EventKind] ?? e.kind, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt.toISOString(), guests: e.guests, location: e.location,
    clientName: e.clientName, clientCompany: e.clientCompany, lines, ...eventTotals(lines), depositAmount: e.depositAmount, quoteNotes: e.quoteNotes, validUntil: e.validUntil?.toISOString() ?? null,
    status: (e.status === "SENT" ? (expired ? "EXPIRED" : "OPEN") : e.status === "CANCELLED" ? "CANCELLED" : e.status === "DRAFT" ? "REVISING" : "ACCEPTED") as "OPEN" | "EXPIRED" | "CANCELLED" | "REVISING" | "ACCEPTED",
    acceptedAt: e.acceptedAt?.toISOString() ?? null, acceptedBy: e.acceptedBy,
  };
}

/** Acceptation en ligne par le client : son nom fait foi, l'heure est enregistrée. */
export async function acceptPublicQuote(token: string, name: string, now = new Date()) {
  const q = await publicQuote(token, now);
  if (q.status === "ACCEPTED") return q;
  if (q.status === "EXPIRED") throw new ApiError(409, "QUOTE_EXPIRED", "Ce devis n'est plus valable : contactez le restaurant pour le renouveler");
  if (q.status !== "OPEN") throw new ApiError(409, "QUOTE_CLOSED", "Ce devis n'est plus disponible : contactez le restaurant");
  const upd = await prisma.cateringEvent.updateMany({ where: { publicToken: token, status: "SENT" }, data: { status: "ACCEPTED", acceptedAt: now, acceptedBy: name.trim() } });
  if (upd.count) {
    const e = await prisma.cateringEvent.findUniqueOrThrow({ where: { publicToken: token }, select: { id: true, establishmentId: true, establishment: { select: { organizationId: true } } } });
    await audit({ organizationId: e.establishment.organizationId, establishmentId: e.establishmentId, userId: null, action: "catering.accept", entityType: "catering_event", entityId: e.id, newValue: { number: q.number, by: name.trim(), online: true } });
  }
  return publicQuote(token, now);
}

// ─── Acomptes, solde, remboursements ───

export async function recordEventPayment(actor: Actor, id: string, input: { amount: number; method: CateringMethod; reference?: string | null; refund?: boolean }, now = new Date()) {
  const e = await findEvent(actor.establishmentId, id);
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new ApiError(400, "BAD_AMOUNT", "Montant invalide");
  const paid = paidOf(e.payments);
  if (input.refund) {
    if (input.amount > paid) throw new ApiError(409, "BAD_AMOUNT", `Vous ne pouvez rembourser que ce qui a été reçu (${formatMoney(paid)})`);
  } else {
    if (e.status === "CANCELLED") throw new ApiError(409, "EVENT_CANCELLED", "Événement annulé : aucun paiement à recevoir");
    if (e.totalTtc <= 0) throw new ApiError(409, "EMPTY_QUOTE", "Composez d'abord le devis : le montant total est nul");
    if (paid + input.amount > e.totalTtc) throw new ApiError(409, "OVERPAID", `Le montant dépasse le reste à payer (${formatMoney(e.totalTtc - paid)})`);
  }
  // Espèces : l'argent entre (ou sort) du tiroir, donc de la session de caisse ouverte
  const session = input.method === "CASH" ? await findOpenSession(actor.establishmentId, actor.terminalId ?? null) : null;
  if (input.method === "CASH" && !session) throw new ApiError(409, "NO_CASH_SESSION", "Ouvrez une session de caisse pour un paiement en espèces");
  const kind = input.refund ? "REFUND" : e.status === "INVOICED" ? "BALANCE" : "DEPOSIT";
  await prisma.$transaction(async (tx) => {
    await tx.cateringPayment.create({ data: { establishmentId: actor.establishmentId, eventId: id, kind, amount: input.amount, method: input.method, reference: trim(input.reference), receivedAt: now, userId: actor.userId, cashSessionId: session?.id ?? null } });
    if (session) await tx.cashMovement.create({ data: { cashSessionId: session.id, userId: actor.userId, kind: input.refund ? "PAY_OUT" : "PAY_IN", amount: input.amount, reason: `${input.refund ? "Remboursement" : kind === "DEPOSIT" ? "Acompte" : "Solde"} événement ${e.title}` } });
    await audit({ ...actor, action: "catering.payment", entityType: "catering_event", entityId: id, newValue: { kind, amount: input.amount, method: input.method } }, tx);
  });
  if (session) publish("cash.updated", actor.establishmentId, { cashSessionId: session.id });
  return getEvent(actor.establishmentId, id);
}

// ─── Facture ───

type Snapshot = { lines: EventLine[]; taxes: EventTaxRow[]; buyer: { name: string; company: string | null; tahitiNumber: string | null; address: string | null; email: string | null } };

/** Facture finale : lignes du devis (ajustées), copie figée, numéro FT continu ; les acomptes reçus s'en déduisent. */
export async function invoiceEvent(actor: Actor, id: string, opts: { dueDays?: number } = {}, now = new Date()) {
  const e = await findEvent(actor.establishmentId, id);
  if (e.status !== "ACCEPTED") throw new ApiError(409, "BAD_STATUS", e.status === "INVOICED" ? "Événement déjà facturé" : "Le devis doit d'abord être confirmé");
  const lines = e.lines as unknown as EventLine[];
  const t = eventTotals(lines);
  if (!lines.length || t.totalTtc <= 0) throw new ApiError(409, "EMPTY_QUOTE", "Rien à facturer : le devis est vide");
  if (paidOf(e.payments) > t.totalTtc) throw new ApiError(409, "OVERPAID", "Les acomptes reçus dépassent le total : remboursez la différence ou complétez les lignes");
  const tz = (await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { timezone: true } })).timezone;
  const snapshot: Snapshot = { lines, taxes: t.taxes, buyer: { name: e.clientName, company: e.clientCompany, tahitiNumber: e.clientTahitiNumber, address: e.clientAddress, email: e.clientEmail } };
  await prisma.$transaction(async (tx) => {
    const year = Number(localDay(now, tz).slice(0, 4));
    const n = await nextNumber(tx, actor.establishmentId, "FT", year);
    const upd = await tx.cateringEvent.updateMany({
      where: { id, status: "ACCEPTED" },
      data: { status: "INVOICED", invoiceNumber: n.number, invoiceYear: year, invoiceSeq: n.seq, invoicedAt: now, invoiceDueAt: new Date(now.getTime() + (opts.dueDays ?? 0) * 86_400_000), invoice: snapshot, totalTtc: t.totalTtc, totalTax: t.totalTax },
    });
    if (!upd.count) throw new ApiError(409, "CONFLICT", "Facturation simultanée : recommencez");
    await audit({ ...actor, action: "catering.invoice", entityType: "catering_event", entityId: id, newValue: { number: n.number, totalTtc: t.totalTtc } }, tx);
  });
  return getEvent(actor.establishmentId, id);
}

// ─── Documents ───

/** Devis ou facture au format PDF (A4). */
export async function renderEventPdf(establishmentId: string, id: string, doc: "quote" | "invoice"): Promise<{ pdf: Buffer; filename: string }> {
  const ev = await findEvent(establishmentId, id);
  const e = await prisma.establishment.findUniqueOrThrow({ where: { id: establishmentId }, select: { name: true, legalName: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, island: true, phone: true, email: true, tahitiNumber: true, timezone: true, currency: true } });
  if (doc === "invoice" && !ev.invoiceNumber) throw new ApiError(409, "NOT_INVOICED", "Cet événement n'est pas encore facturé");
  const snap = doc === "invoice" ? (ev.invoice as unknown as Snapshot) : null;
  const lines = snap?.lines ?? (ev.lines as unknown as EventLine[]);
  const t = eventTotals(lines);
  const buyer = snap?.buyer ?? { name: ev.clientName, company: ev.clientCompany, tahitiNumber: ev.clientTahitiNumber, address: ev.clientAddress, email: ev.clientEmail };
  const paid = paidOf(ev.payments);
  const tz = e.timezone;
  const number = doc === "invoice" ? ev.invoiceNumber! : ev.quoteNumber;
  const strip = (ch: string) => ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const safe = (s: string) => [...s].map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : /^[\x20-\x7e\xa0-\xff]$/.test(strip(ch)) ? strip(ch) : "")).join("");
  const money = (n: number) => safe(formatMoney(n, e.currency));
  const PDFDocument = (await import("pdfkit")).default;
  const title = doc === "invoice" ? `Facture ${number}` : number ? `Devis ${number}` : "Devis (brouillon)";
  const pdf = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 40, right: 40 }, info: { Title: title, Author: e.legalName || e.name } });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => pdf.on("end", () => resolve(Buffer.concat(chunks))));
  const W = 515, L = 40, BRAND = "#0d8a86", INK = "#0f172a", MUTED = "#64748b";

  pdf.rect(0, 0, 595, 96).fill(BRAND);
  pdf.fillColor("#fff").font("Helvetica-Bold").fontSize(18).text(safe(e.legalName || e.name), L, 28, { width: 300 });
  pdf.font("Helvetica").fontSize(8.5).fillColor("#d3f7f2");
  const seller = [e.legalName && e.legalName !== e.name ? e.name : null, e.addressLine1, e.addressLine2, [e.postalCode, e.city].filter(Boolean).join(" "), e.island, e.phone ? `Tél. ${e.phone}` : null, e.email, e.tahitiNumber ? `N° Tahiti ${e.tahitiNumber}` : null].filter(Boolean) as string[];
  pdf.text(safe(seller.join(" · ")), L, 52, { width: 330 });
  pdf.font("Helvetica-Bold").fontSize(10).fillColor("#fff").text(doc === "invoice" ? "FACTURE" : "DEVIS", 380, 28, { width: 175, align: "right" });
  pdf.fontSize(16).text(safe(number ?? "Brouillon"), 380, 42, { width: 175, align: "right" });
  const issued = doc === "invoice" ? ev.invoicedAt! : ev.quoteSentAt ?? new Date();
  pdf.font("Helvetica").fontSize(9).fillColor("#d3f7f2").text(safe(`${doc === "invoice" ? "Émise" : "Établi"} le ${formatDate(issued, tz)}`), 380, 64, { width: 175, align: "right" });

  // Événement et client
  let y = 116;
  pdf.roundedRect(L, y, 250, 92, 8).fill("#f1f4f8");
  pdf.fillColor(MUTED).font("Helvetica").fontSize(8).text("ÉVÉNEMENT", L + 12, y + 10);
  pdf.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(safe(ev.title), L + 12, y + 22, { width: 226 });
  pdf.font("Helvetica").fontSize(9).text(safe([
    `${EVENT_KINDS[ev.kind as EventKind] ?? ev.kind} · ${ev.guests} personne${ev.guests > 1 ? "s" : ""}`,
    `${formatDate(ev.startsAt, tz)}, ${formatTime(ev.startsAt, tz)} - ${formatTime(ev.endsAt, tz)}`,
    ev.location ? `Lieu : ${ev.location}` : "Au restaurant",
  ].join("\n")), L + 12, y + 38, { width: 226 });
  pdf.roundedRect(L + W - 250, y, 250, 92, 8).fill("#f1f4f8");
  pdf.fillColor(MUTED).font("Helvetica").fontSize(8).text(doc === "invoice" ? "FACTURÉ À" : "CLIENT", L + W - 238, y + 10);
  pdf.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(safe(buyer.company || buyer.name), L + W - 238, y + 22, { width: 226 });
  pdf.font("Helvetica").fontSize(9).text(safe([buyer.company ? buyer.name : null, buyer.address, buyer.tahitiNumber ? `N° Tahiti ${buyer.tahitiNumber}` : null].filter(Boolean).join("\n")), L + W - 238, y + 38, { width: 226 });

  // Lignes
  y = 226;
  pdf.rect(L, y, W, 18).fill("#f1f4f8");
  pdf.fillColor(INK).font("Helvetica-Bold").fontSize(8.5).text("Désignation", L + 8, y + 5).text("Qté", L + 270, y + 5, { width: 40, align: "right" }).text("PU TTC", L + 315, y + 5, { width: 70, align: "right" }).text("TVA", L + 390, y + 5, { width: 40, align: "right" }).text("Total TTC", L + 430, y + 5, { width: 77, align: "right" });
  y += 22;
  pdf.font("Helvetica").fontSize(8.5);
  for (const l of lines) {
    if (y > 700) { pdf.addPage(); y = 50; }
    const h = Math.max(12, pdf.heightOfString(safe(l.label), { width: 255 }));
    pdf.fillColor(INK).text(safe(l.label), L + 8, y, { width: 255 }).text(String(l.quantity).replace(".", ","), L + 270, y, { width: 40, align: "right" }).text(money(l.unitPrice), L + 315, y, { width: 70, align: "right" })
      .text(safe(`${(l.taxRateBps / 100).toString().replace(".", ",")} %`), L + 390, y, { width: 40, align: "right" }).text(money(Math.round(l.quantity * l.unitPrice)), L + 430, y, { width: 77, align: "right" });
    y += h + 4;
    pdf.moveTo(L, y - 3).lineTo(L + W, y - 3).strokeColor("#e4e9ef").lineWidth(0.5).stroke();
  }

  // TVA et totaux
  y += 10;
  if (y > 600) { pdf.addPage(); y = 50; }
  const top = y;
  pdf.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED).text("TVA", L, y);
  y += 14;
  pdf.font("Helvetica").fillColor(INK);
  for (const r of t.taxes) { pdf.text(safe(`${r.name} : base HT ${formatMoney(r.ht, e.currency)} · TVA ${formatMoney(r.tax, e.currency)}`), L, y, { width: 280 }); y += 13; }
  let ty = top;
  const row = (label: string, value: string, bold = false) => { pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 9).fillColor(bold ? BRAND : INK).text(safe(label), L + 300, ty, { width: 110 }).text(value, L + 410, ty, { width: 97, align: "right" }); ty += bold ? 20 : 14; };
  row("Total HT", money(t.totalHt));
  row("TVA", money(t.totalTax));
  row("Total TTC", money(t.totalTtc), true);
  if (doc === "invoice") {
    if (paid > 0) { row("Déjà réglé", money(paid)); row("Reste à payer", money(Math.max(0, t.totalTtc - paid)), true); }
  } else if (ev.depositAmount > 0) row("Acompte", money(ev.depositAmount), true);
  y = Math.max(y, ty) + 12;

  if (doc === "quote") {
    if (ev.quoteNotes) {
      if (y > 660) { pdf.addPage(); y = 50; }
      pdf.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED).text("PRÉCISIONS", L, y);
      pdf.font("Helvetica").fontSize(9).fillColor(INK).text(safe(ev.quoteNotes), L, y + 13, { width: W });
      y = pdf.y + 12;
    }
    if (y > 680) { pdf.addPage(); y = 50; }
    if (ev.validUntil) { pdf.font("Helvetica").fontSize(9).fillColor(INK).text(safe(`Devis valable jusqu'au ${formatDate(ev.validUntil, tz)}.`), L, y); y += 16; }
    pdf.roundedRect(L + W - 250, y, 250, 70, 8).strokeColor("#cbd5e1").lineWidth(1).stroke();
    pdf.font("Helvetica").fontSize(8).fillColor(MUTED).text(safe("Bon pour accord : date et signature"), L + W - 238, y + 8);
    if (ev.acceptedAt) pdf.fillColor(BRAND).font("Helvetica-Bold").fontSize(9).text(safe(ev.acceptedBy ? `Accepté en ligne par ${ev.acceptedBy} le ${formatDate(ev.acceptedAt, tz)} à ${formatTime(ev.acceptedAt, tz)}` : `Confirmé le ${formatDate(ev.acceptedAt, tz)}`), L + W - 238, y + 26, { width: 226 });
  } else {
    pdf.font("Helvetica").fontSize(8).fillColor(MUTED).text(safe(`Facture à régler ${ev.invoiceDueAt && ev.invoicedAt && ev.invoiceDueAt.getTime() - ev.invoicedAt.getTime() > 86_400_000 ? `avant le ${formatDate(ev.invoiceDueAt, tz)}` : "à réception"}. Merci de rappeler le numéro ${number} avec votre règlement.`), L, 760, { width: W, align: "center" });
  }
  pdf.end();
  return { pdf: await done, filename: `${doc === "invoice" ? "facture" : "devis"}-${number ?? "brouillon"}.pdf` };
}

// ─── Privatisation et réservations ───

/** Événement confirmé qui privatise le restaurant au moment demandé (réservation en ligne refusée). */
export async function privatizedAt(establishmentId: string, startsAt: Date, durationMinutes: number) {
  return prisma.cateringEvent.findFirst({
    where: { establishmentId, privatize: true, status: { in: ["ACCEPTED", "INVOICED"] }, startsAt: { lt: new Date(startsAt.getTime() + durationMinutes * 60_000) }, endsAt: { gt: startsAt } },
    select: { id: true, title: true, startsAt: true, endsAt: true },
  });
}

/** Événements confirmés d'un jour : bandeau de la page Réservations. */
export async function eventsOfDay(establishmentId: string, day: string, timezone: string) {
  const rows = await prisma.cateringEvent.findMany({
    where: { establishmentId, status: { in: ["ACCEPTED", "INVOICED"] }, startsAt: { lt: endOfLocalDay(day, timezone) }, endsAt: { gt: startOfLocalDay(day, timezone) } },
    orderBy: { startsAt: "asc" }, select: { id: true, title: true, startsAt: true, endsAt: true, guests: true, privatize: true, location: true },
  });
  return rows.map((r) => ({ ...r, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() }));
}

export { CATERING_METHODS };
