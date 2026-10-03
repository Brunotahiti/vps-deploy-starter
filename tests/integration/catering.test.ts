import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { sentMails } from "@/server/email/mailer";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { lockedPermissions } from "@/lib/options";
import { eventTotals, type EventLine } from "@/lib/catering";
import { openSession } from "@/server/services/cash";
import { createPublicReservation } from "@/server/services/reservations";
import { buildAccountingExport } from "@/server/reports/export";
import {
  acceptPublicQuote, acceptQuote, cancelEvent, createEvent, deleteEvent, eventsOfDay, getEvent, invoiceEvent, listEvents, listEventsLite, publicQuote, quoteCatalog,
  recordEventPayment, renderEventPdf, sendQuote, updateEvent,
} from "@/server/services/catering";

let T: Awaited<ReturnType<typeof makeTenant>>;
const year = new Date().getUTCFullYear();
const inDays = (d: number, h = 18) => { const x = new Date(Date.now() + d * 86_400_000); x.setUTCHours(h + 10, 0, 0, 0); return x; }; // h heure de Tahiti
const at = (d: number, h: number, dur = 5) => ({ startsAt: inDays(d, h).toISOString(), endsAt: new Date(inDays(d, h).getTime() + dur * 3600_000).toISOString() });
const BUFFET: EventLine[] = [
  { label: "Buffet polynésien (poisson cru, chao men, poulet fafa)", quantity: 40, unitPrice: 3500, taxRateBps: 1300, taxRateName: "TVA 13 %" },
  { label: "Boissons sans alcool à volonté", quantity: 40, unitPrice: 800, taxRateBps: 1300, taxRateName: "TVA 13 %" },
  { label: "Vin rouge (bouteille)", quantity: 10, unitPrice: 2500, taxRateBps: 1600, taxRateName: "TVA 16 %" },
];

beforeAll(async () => {
  process.env.EMAIL_TRANSPORT = "memory";
  await resetDb();
  T = await makeTenant("traiteur");
});

describe("Traiteur & événements", () => {
  it("option, droits et calcul du devis", () => {
    expect(lockedPermissions(["stock"]).has("catering.manage")).toBe(true);
    expect(lockedPermissions(["catering"]).has("catering.view")).toBe(false);
    expect(SYSTEM_ROLES.kitchen.permissions).toContain("catering.view");
    expect(SYSTEM_ROLES.kitchen.permissions).not.toContain("catering.manage");
    expect(SYSTEM_ROLES.manager.permissions).toEqual(expect.arrayContaining(["catering.view", "catering.manage"]));
    const t = eventTotals(BUFFET);
    expect(t.totalTtc).toBe(40 * 3500 + 40 * 800 + 10 * 2500);
    expect(t.taxes.map((r) => r.rateBps)).toEqual([1300, 1600]);
    expect(t.taxes.every((r) => r.ht + r.tax === r.ttc)).toBe(true);
    expect(eventTotals([{ label: "Demi-portion", quantity: 0.5, unitPrice: 1001, taxRateBps: 0, taxRateName: null }]).totalTtc).toBe(501);
  });

  it("devis : brouillon, numéro au premier envoi, modification d'un devis envoyé", async () => {
    const e = await createEvent(T.managerActor, { title: "Mariage Teva & Hina", kind: "WEDDING", ...at(30, 17, 6), guests: 40, clientName: "Teva", clientEmail: "teva@exemple.pf", privatize: true });
    expect(e).toMatchObject({ status: "DRAFT", quoteNumber: null, totalTtc: 0 });
    await expect(sendQuote(T.managerActor, e.id, { email: false })).rejects.toMatchObject({ code: "EMPTY_QUOTE" });
    await expect(updateEvent(T.managerActor, e.id, { endsAt: e.startsAt })).rejects.toMatchObject({ code: "BAD_DATE" });
    await expect(updateEvent(T.managerActor, e.id, { lines: BUFFET, depositAmount: 500_000 })).rejects.toMatchObject({ code: "BAD_DEPOSIT" });
    const u = await updateEvent(T.managerActor, e.id, { lines: BUFFET, depositAmount: 60_000 });
    expect(u).toMatchObject({ totalTtc: 197_000, depositAmount: 60_000 });

    const sent = await sendQuote(T.managerActor, e.id, { email: false });
    expect(sent).toMatchObject({ status: "SENT", quoteNumber: `DV-${year}-0001` });
    expect(new Date(sent.validUntil!).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    // Contenu modifié : à renvoyer, même numéro
    const edited = await updateEvent(T.managerActor, e.id, { guests: 45 });
    expect(edited).toMatchObject({ status: "DRAFT", quoteNumber: `DV-${year}-0001`, validUntil: null });
    // Note interne seule : le devis reste envoyé
    const again = await sendQuote(T.managerActor, e.id, { email: false });
    expect(again.quoteNumber).toBe(`DV-${year}-0001`);
    expect((await updateEvent(T.managerActor, e.id, { internalNotes: "Rappeler pour le gâteau" })).status).toBe("SENT");

    const other = await createEvent(T.managerActor, { title: "Repas d'entreprise", kind: "CORPORATE", ...at(10, 12, 2), guests: 20, clientName: "Lagon SARL", lines: BUFFET.slice(0, 1) });
    expect((await sendQuote(T.managerActor, other.id, { email: false })).quoteNumber).toBe(`DV-${year}-0002`);
  });

  it("envoi par e-mail : PDF joint, acceptation en ligne par le client", async () => {
    const [e] = (await listEvents(T.est.id, "Pacific/Tahiti")).filter((x) => x.kind === "WEDDING");
    sentMails.length = 0;
    const sent = await sendQuote(T.managerActor, e.id, { email: true, validityDays: 15 });
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]).toMatchObject({ to: "teva@exemple.pf", subject: expect.stringContaining(`Devis DV-${year}-0001`) });
    expect(sentMails[0].text).toContain(`/devis/${sent.publicToken}`);
    expect(sentMails[0].attachments?.[0]?.filename).toBe(`devis-DV-${year}-0001.pdf`);

    const q = await publicQuote(sent.publicToken);
    expect(q).toMatchObject({ status: "OPEN", number: `DV-${year}-0001`, totalTtc: 197_000, guests: 45 });
    expect(q).not.toHaveProperty("internalNotes");
    await expect(publicQuote("inconnu")).rejects.toMatchObject({ code: "NOT_FOUND" });
    const accepted = await acceptPublicQuote(sent.publicToken, "Teva Tehei");
    expect(accepted).toMatchObject({ status: "ACCEPTED", acceptedBy: "Teva Tehei" });
    expect((await getEvent(T.est.id, e.id)).status).toBe("ACCEPTED");
    // Accepté : le restaurant peut encore ajuster le nombre d'invités, le statut reste confirmé
    expect((await updateEvent(T.managerActor, e.id, { guests: 42 })).status).toBe("ACCEPTED");
  });

  it("devis expiré : refusé en ligne ; confirmation sur papier par le restaurant", async () => {
    const e = await createEvent(T.managerActor, { title: "Anniversaire", kind: "BUFFET", ...at(20, 19, 4), guests: 15, clientName: "Moana", lines: BUFFET.slice(0, 2) });
    await expect(acceptQuote(T.managerActor, e.id)).rejects.toMatchObject({ code: "QUOTE_NOT_SENT" });
    const sent = await sendQuote(T.managerActor, e.id, { email: false });
    await prisma.cateringEvent.update({ where: { id: e.id }, data: { validUntil: new Date(Date.now() - 60_000) } });
    expect((await publicQuote(sent.publicToken)).status).toBe("EXPIRED");
    await expect(acceptPublicQuote(sent.publicToken, "Moana")).rejects.toMatchObject({ code: "QUOTE_EXPIRED" });
    expect(await acceptQuote(T.managerActor, e.id)).toMatchObject({ status: "ACCEPTED", acceptedBy: null });
  });

  it("acomptes, facture finale (acomptes déduits), solde, puis plus de modification", async () => {
    const [e] = (await listEvents(T.est.id, "Pacific/Tahiti")).filter((x) => x.kind === "WEDDING");
    await expect(recordEventPayment(T.managerActor, e.id, { amount: 60_000, method: "CASH" })).rejects.toMatchObject({ code: "NO_CASH_SESSION" });
    const { session } = await openSession(T.managerActor, { openingFloat: 0 });
    let v = await recordEventPayment(T.managerActor, e.id, { amount: 60_000, method: "CASH" });
    expect(await prisma.cashMovement.findFirst({ where: { cashSessionId: session.id, kind: "PAY_IN" } })).toMatchObject({ amount: 60_000, reason: "Acompte événement Mariage Teva & Hina" });
    expect(v).toMatchObject({ paid: 60_000, depositDue: 0, remaining: 137_000 });
    expect(v.payments[0].kind).toBe("DEPOSIT");
    await expect(recordEventPayment(T.managerActor, e.id, { amount: 200_000, method: "TRANSFER" })).rejects.toMatchObject({ code: "OVERPAID" });

    v = await invoiceEvent(T.managerActor, e.id, { dueDays: 15 });
    expect(v).toMatchObject({ status: "INVOICED", invoiceNumber: `FT-${year}-0001`, remaining: 137_000 });
    await expect(invoiceEvent(T.managerActor, e.id)).rejects.toMatchObject({ code: "BAD_STATUS" });
    await expect(updateEvent(T.managerActor, e.id, { guests: 50 })).rejects.toMatchObject({ code: "EVENT_LOCKED" });
    await expect(cancelEvent(T.managerActor, e.id, "Pluie")).rejects.toMatchObject({ code: "EVENT_LOCKED" });
    v = await recordEventPayment(T.managerActor, e.id, { amount: 137_000, method: "TRANSFER", reference: "VIR 0412" });
    expect(v).toMatchObject({ remaining: 0, paid: 197_000 });
    expect(v.payments[1].kind).toBe("BALANCE");

    const quote = await renderEventPdf(T.est.id, e.id, "quote");
    const invoice = await renderEventPdf(T.est.id, e.id, "invoice");
    expect(quote.pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(invoice.filename).toBe(`facture-FT-${year}-0001.pdf`);
    const other = (await listEvents(T.est.id, "Pacific/Tahiti")).find((x) => x.kind === "CORPORATE")!;
    await expect(renderEventPdf(T.est.id, other.id, "invoice")).rejects.toMatchObject({ code: "NOT_INVOICED" });
  });

  it("annulation avec remboursement de l'acompte ; suppression d'un simple brouillon", async () => {
    const other = (await listEvents(T.est.id, "Pacific/Tahiti")).find((x) => x.kind === "CORPORATE")!;
    await recordEventPayment(T.managerActor, other.id, { amount: 20_000, method: "CARD" });
    await cancelEvent(T.managerActor, other.id, "Séminaire reporté");
    await expect(recordEventPayment(T.managerActor, other.id, { amount: 1000, method: "CARD" })).rejects.toMatchObject({ code: "EVENT_CANCELLED" });
    await expect(recordEventPayment(T.managerActor, other.id, { amount: 30_000, method: "CARD", refund: true })).rejects.toMatchObject({ code: "BAD_AMOUNT" });
    const v = await recordEventPayment(T.managerActor, other.id, { amount: 20_000, method: "CARD", refund: true });
    expect(v).toMatchObject({ status: "CANCELLED", paid: 0 });
    await expect(deleteEvent(T.managerActor, other.id)).rejects.toMatchObject({ code: "EVENT_NUMBERED" });
    const draft = await createEvent(T.managerActor, { title: "Idée de buffet", kind: "OTHER", ...at(40, 12, 3), guests: 10, clientName: "X" });
    await deleteEvent(T.managerActor, draft.id);
    expect(await prisma.cateringEvent.findUnique({ where: { id: draft.id } })).toBeNull();
  });

  it("privatisation : réservations en ligne refusées pendant l'événement, bandeau du jour", async () => {
    const [e] = (await listEvents(T.est.id, "Pacific/Tahiti")).filter((x) => x.kind === "WEDDING");
    const during = new Date(new Date(e.startsAt).getTime() + 3600_000).toISOString();
    await expect(createPublicReservation(T.est.id, T.org.id, { name: "Hina", phone: "87 11 22 33", email: "hina@exemple.pf", startsAt: during, partySize: 2 })).rejects.toMatchObject({ code: "PRIVATIZED" });
    const lunch = new Date(new Date(e.startsAt).getTime() - 6 * 3600_000).toISOString();
    expect((await createPublicReservation(T.est.id, T.org.id, { name: "Hina", phone: "87 11 22 33", email: "hina@exemple.pf", startsAt: lunch, partySize: 2 })).status).toBe("PENDING");
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Tahiti" }).format(new Date(e.startsAt));
    const events = await eventsOfDay(T.est.id, day, "Pacific/Tahiti");
    expect(events.map((x) => x.title)).toContain("Mariage Teva & Hina");
    // Planning sans montants pour la cuisine et la salle ; annulés exclus
    const lite = await listEventsLite(T.est.id, "Pacific/Tahiti");
    expect(lite[0]).not.toHaveProperty("totalTtc");
    expect(lite.some((x) => x.status === "CANCELLED")).toBe(false);
  });

  it("catalogue du devis et export comptable : journal TR équilibré", async () => {
    const cat = await quoteCatalog(T.est.id);
    expect(cat.products.find((p) => p.name === "Bière")).toMatchObject({ priceTtc: 600, taxRateBps: 1600 });
    expect(cat.taxRates.length).toBeGreaterThan(0);
    const ex = await buildAccountingExport(T.est.id, "2020-01-01", "2035-12-31", "Pacific/Tahiti");
    const tr = ex.sheets.find((s) => s.name === "Écritures")!.rows.filter((r) => r[1] === "TR");
    const debit = tr.reduce((s, r) => s + Number(r[4]), 0), credit = tr.reduce((s, r) => s + Number(r[5]), 0);
    expect(debit).toBe(credit);
    expect(tr.some((r) => r[2] === "411000" && String(r[3]).includes(`FT-${year}-0001`) && r[4] === 197_000)).toBe(true);
    expect(tr.some((r) => r[2] === "530000" && r[4] === 60_000)).toBe(true);
    expect(ex.sheets.find((s) => s.name === "Traiteur")!.rows.length).toBe(5); // 1 facture, 4 paiements
  });
});
