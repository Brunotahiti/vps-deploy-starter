import { prisma, type Tx } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { publish } from "@/server/realtime/bus";
import { formatMoney } from "@/lib/money";
import { endOfLocalDay, formatDate, localDay } from "@/lib/dates";
import { findOpenSession } from "./cash";
import { assertNotDemoEmail } from "./demo";
import type { Actor } from "./orders";

/**
 * Comptes clients & factures pro (option « accounts ») : un client pro consomme « sur compte » (paiement ACCOUNT),
 * on le facture ensuite (numérotation continue, facture figée), il règle (chèque, virement…) et ses règlements
 * soldent ses factures, les plus anciennes d'abord. Encours = consommations − règlements.
 */

export type SettlementMethod = "CASH" | "CARD" | "CHECK" | "TRANSFER";
export const SETTLEMENT_LABEL: Record<SettlementMethod, string> = { CASH: "Espèces", CARD: "Carte bancaire", CHECK: "Chèque", TRANSFER: "Virement" };

type Db = Tx | typeof prisma;

/** Consommations nettes (remboursements déduits) et règlements d'un compte. */
async function totals(db: Db, accountId: string) {
  const [charged, settled] = await Promise.all([
    db.payment.aggregate({ where: { customerAccountId: accountId, method: "ACCOUNT", status: { not: "VOIDED" } }, _sum: { amount: true, refundedAmount: true } }),
    db.accountSettlement.aggregate({ where: { accountId }, _sum: { amount: true } }),
  ]);
  const c = (charged._sum.amount ?? 0) - (charged._sum.refundedAmount ?? 0);
  const s = settled._sum.amount ?? 0;
  return { charged: c, settled: s, balance: c - s };
}

/**
 * Contrôle d'une addition mise sur compte, DANS la transaction d'encaissement et sous verrou du compte :
 * deux tablettes ne peuvent pas dépasser le plafond ensemble. Au rejeu d'un encaissement fait hors ligne,
 * le plafond n'est pas opposé (le client est déjà parti).
 */
export async function assertAccountCharge(tx: Tx, actor: Actor, accountId: string | null | undefined, amount: number, opts: { offlineReplay?: boolean } = {}) {
  if (!accountId) throw new ApiError(400, "ACCOUNT_REQUIRED", "Choisissez le compte client à débiter");
  await tx.$queryRaw`SELECT id FROM customer_accounts WHERE id = ${accountId}::uuid FOR UPDATE`;
  const account = await tx.customerAccount.findFirst({ where: { id: accountId, establishmentId: actor.establishmentId } });
  if (!account) throw new ApiError(404, "NOT_FOUND", "Compte client introuvable");
  if (!account.isActive && !opts.offlineReplay) throw new ApiError(409, "ACCOUNT_INACTIVE", `Le compte « ${account.name} » est fermé`);
  if (account.creditLimit !== null && !opts.offlineReplay) {
    const { balance } = await totals(tx, accountId);
    if (balance + amount > account.creditLimit) {
      throw new ApiError(409, "CREDIT_LIMIT", `Plafond du compte « ${account.name} » atteint : encours ${formatMoney(balance)}, plafond ${formatMoney(account.creditLimit)}. Il reste ${formatMoney(Math.max(0, account.creditLimit - balance))} disponible.`, { balance, creditLimit: account.creditLimit });
    }
  }
  return account;
}

/** Les options de l'entreprise doivent inclure « accounts » pour mettre une addition sur compte. */
export async function assertAccountsOption(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { options: true } });
  if (!org?.options.includes("accounts")) throw new ApiError(403, "OPTION_REQUIRED", "Option « Comptes clients & factures pro » à débloquer dans Gestion → Options", { option: "accounts" });
}

// ─── Comptes ───

type AccountInput = { name: string; tahitiNumber?: string | null; contactName?: string | null; email?: string | null; phone?: string | null; address?: string | null; creditLimit?: number | null; paymentTermsDays?: number; notes?: string | null; isActive?: boolean };

export async function upsertAccount(actor: Actor, input: AccountInput & { id?: string }) {
  const data = {
    name: input.name.trim(), tahitiNumber: input.tahitiNumber?.trim() || null, contactName: input.contactName?.trim() || null, email: input.email?.trim() || null,
    phone: input.phone?.trim() || null, address: input.address?.trim() || null, creditLimit: input.creditLimit ?? null, notes: input.notes?.trim() || null,
    ...(input.paymentTermsDays !== undefined ? { paymentTermsDays: input.paymentTermsDays } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
  };
  if (input.id) {
    const old = await prisma.customerAccount.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!old) throw new ApiError(404, "NOT_FOUND", "Compte client introuvable");
    const a = await prisma.customerAccount.update({ where: { id: old.id }, data });
    await audit({ ...actor, action: "account.update", entityType: "customer_account", entityId: a.id, oldValue: { name: old.name, creditLimit: old.creditLimit, isActive: old.isActive }, newValue: { name: a.name, creditLimit: a.creditLimit, isActive: a.isActive } });
    return a;
  }
  const a = await prisma.customerAccount.create({ data: { ...data, establishmentId: actor.establishmentId } });
  await audit({ ...actor, action: "account.create", entityType: "customer_account", entityId: a.id, newValue: { name: a.name, creditLimit: a.creditLimit } });
  return a;
}

/** Statut des factures : les règlements soldent les factures les plus anciennes d'abord ; le surplus est une avance. */
function invoiceStatuses<T extends { id: string; totalTtc: number; issuedAt: Date; dueAt: Date }>(invoices: T[], settled: number, now: Date) {
  let left = settled;
  const out = [...invoices].sort((a, b) => a.issuedAt.getTime() - b.issuedAt.getTime()).map((inv) => {
    const paid = Math.min(inv.totalTtc, Math.max(0, left));
    left -= paid;
    const remaining = inv.totalTtc - paid;
    return { ...inv, paid, remaining, status: (remaining === 0 ? "PAID" : inv.dueAt < now ? "OVERDUE" : "ISSUED") as "PAID" | "OVERDUE" | "ISSUED" };
  });
  return { invoices: out, credit: Math.max(0, left) };
}

/** Liste des comptes avec encours, non facturé et retard. */
export async function listAccounts(establishmentId: string, now = new Date()) {
  const accounts = await prisma.customerAccount.findMany({ where: { establishmentId }, orderBy: [{ isActive: "desc" }, { name: "asc" }], include: { invoices: { select: { id: true, totalTtc: true, issuedAt: true, dueAt: true } } } });
  return Promise.all(accounts.map(async (a) => {
    const t = await totals(prisma, a.id);
    const uninvoiced = await prisma.payment.aggregate({ where: { customerAccountId: a.id, method: "ACCOUNT", invoiceId: null, status: { not: "VOIDED" } }, _sum: { amount: true, refundedAmount: true } });
    const st = invoiceStatuses(a.invoices, t.settled, now);
    return {
      id: a.id, name: a.name, tahitiNumber: a.tahitiNumber, contactName: a.contactName, email: a.email, phone: a.phone, address: a.address, creditLimit: a.creditLimit, paymentTermsDays: a.paymentTermsDays, notes: a.notes, isActive: a.isActive,
      balance: t.balance, uninvoiced: (uninvoiced._sum.amount ?? 0) - (uninvoiced._sum.refundedAmount ?? 0),
      overdue: st.invoices.filter((i) => i.status === "OVERDUE").reduce((s, i) => s + i.remaining, 0),
    };
  }));
}

/** Comptes ouverts pour la caisse : nom, encours, disponible sous le plafond. */
export async function accountsForPos(establishmentId: string) {
  const list = await listAccounts(establishmentId);
  return list.filter((a) => a.isActive).map((a) => ({ id: a.id, name: a.name, contactName: a.contactName, balance: a.balance, creditLimit: a.creditLimit, available: a.creditLimit === null ? null : Math.max(0, a.creditLimit - a.balance) }));
}

/** Détail d'un compte : consommations, règlements et factures avec leur statut. */
export async function getAccount(establishmentId: string, id: string, now = new Date()) {
  const a = await prisma.customerAccount.findFirst({ where: { id, establishmentId } });
  if (!a) throw new ApiError(404, "NOT_FOUND", "Compte client introuvable");
  const [charges, settlements, invoices, t] = await Promise.all([
    prisma.payment.findMany({ where: { customerAccountId: id, method: "ACCOUNT", status: { not: "VOIDED" } }, orderBy: { createdAt: "desc" }, take: 500, include: { order: { select: { id: true, number: true, closedAt: true, customerName: true } }, invoice: { select: { number: true } } } }),
    prisma.accountSettlement.findMany({ where: { accountId: id }, orderBy: { receivedAt: "desc" }, take: 500 }),
    prisma.accountInvoice.findMany({ where: { accountId: id }, select: { id: true, number: true, issuedAt: true, dueAt: true, totalTtc: true, totalTax: true, remindedAt: true, reminderCount: true } }),
    totals(prisma, id),
  ]);
  const st = invoiceStatuses(invoices, t.settled, now);
  return {
    account: a, balance: t.balance, charged: t.charged, settled: t.settled, credit: st.credit,
    uninvoiced: charges.filter((c) => !c.invoiceId).reduce((s, c) => s + c.amount - c.refundedAmount, 0),
    charges: charges.map((c) => ({ id: c.id, at: c.createdAt.toISOString(), orderId: c.order.id, orderNumber: c.order.number, amount: c.amount - c.refundedAmount, refunded: c.refundedAmount, invoiceNumber: c.invoice?.number ?? null, label: c.splitLabel })),
    settlements: settlements.map((s) => ({ id: s.id, at: s.receivedAt.toISOString(), amount: s.amount, method: s.method as SettlementMethod, reference: s.reference, note: s.note })),
    invoices: st.invoices.sort((x, y) => y.issuedAt.getTime() - x.issuedAt.getTime()).map((i) => ({ id: i.id, number: i.number, issuedAt: i.issuedAt.toISOString(), dueAt: i.dueAt.toISOString(), totalTtc: i.totalTtc, totalTax: i.totalTax, paid: i.paid, remaining: i.remaining, status: i.status, remindedAt: i.remindedAt?.toISOString() ?? null, reminderCount: i.reminderCount })),
  };
}

// ─── Facturation ───

type TaxRow = { rateBps: number; name: string; ht: number; tax: number; ttc: number };
export type InvoiceLine = { paymentId: string; date: string; orderNumber: string; label: string; ttc: number; taxes: TaxRow[] };

/** Ventilation TVA d'un montant imputé à une commande, au prorata de ses lignes (remise globale comprise). */
function lineTaxes(order: { total: number; subtotal: number; items: { lineTotal: number; taxAmount: number; taxRateBps: number; taxRateName: string | null }[] }, amount: number): TaxRow[] {
  const ratio = order.subtotal > 0 ? order.total / order.subtotal : 1;
  const share = order.total > 0 ? amount / order.total : 0;
  const byRate = new Map<number, TaxRow>();
  for (const it of order.items) {
    const r = byRate.get(it.taxRateBps) ?? { rateBps: it.taxRateBps, name: it.taxRateName ?? `${it.taxRateBps / 100} %`, ht: 0, tax: 0, ttc: 0 };
    r.ttc += it.lineTotal * ratio * share; r.tax += it.taxAmount * ratio * share;
    byRate.set(it.taxRateBps, r);
  }
  const rows = [...byRate.values()].map((r) => ({ ...r, ttc: Math.round(r.ttc), tax: Math.round(r.tax) }));
  // Arrondis : le TTC des taux fait exactement le montant imputé
  const diff = amount - rows.reduce((s, r) => s + r.ttc, 0);
  if (rows.length) rows[rows.length - 1].ttc += diff;
  return rows.map((r) => ({ ...r, ht: r.ttc - r.tax }));
}

/** Facture tout ce qui n'a pas encore été facturé sur le compte (jusqu'au jour indiqué inclus). */
export async function createInvoice(actor: Actor, accountId: string, opts: { upTo?: string } = {}, now = new Date()) {
  const account = await prisma.customerAccount.findFirst({ where: { id: accountId, establishmentId: actor.establishmentId }, include: { establishment: { select: { timezone: true } } } });
  if (!account) throw new ApiError(404, "NOT_FOUND", "Compte client introuvable");
  const tz = account.establishment.timezone;
  const until = opts.upTo ? endOfLocalDay(opts.upTo, tz) : now;
  const invoice = await prisma.$transaction(async (tx) => {
    // Un seul numéro à la fois par établissement : numérotation continue, sans trou ni doublon
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${actor.establishmentId}`}))`;
    const charges = await tx.payment.findMany({
      where: { customerAccountId: accountId, method: "ACCOUNT", invoiceId: null, status: { not: "VOIDED" }, createdAt: { lte: until } },
      orderBy: { createdAt: "asc" },
      include: { order: { select: { number: true, closedAt: true, total: true, subtotal: true, items: { where: { status: { not: "VOIDED" } }, select: { lineTotal: true, taxAmount: true, taxRateBps: true, taxRateName: true } } } } },
    });
    const billable = charges.filter((c) => c.amount - c.refundedAmount > 0);
    if (!billable.length) throw new ApiError(409, "NOTHING_TO_INVOICE", "Rien à facturer : aucune consommation sur compte en attente");
    const lines: InvoiceLine[] = billable.map((c) => {
      const amount = c.amount - c.refundedAmount;
      const day = c.order.closedAt ?? c.createdAt;
      return { paymentId: c.id, date: day.toISOString(), orderNumber: c.order.number, label: `Commande ${c.order.number} du ${formatDate(day, tz)}${c.splitLabel ? ` (${c.splitLabel})` : ""}`, ttc: amount, taxes: lineTaxes(c.order, amount) };
    });
    const taxMap = new Map<number, TaxRow>();
    for (const l of lines) for (const t of l.taxes) {
      const r = taxMap.get(t.rateBps) ?? { rateBps: t.rateBps, name: t.name, ht: 0, tax: 0, ttc: 0 };
      r.ht += t.ht; r.tax += t.tax; r.ttc += t.ttc; taxMap.set(t.rateBps, r);
    }
    const taxes = [...taxMap.values()].sort((a, b) => a.rateBps - b.rateBps);
    const year = Number(localDay(now, tz).slice(0, 4));
    const last = await tx.accountInvoice.findFirst({ where: { establishmentId: actor.establishmentId, year }, orderBy: { seq: "desc" }, select: { seq: true } });
    const seq = (last?.seq ?? 0) + 1;
    const inv = await tx.accountInvoice.create({
      data: {
        establishmentId: actor.establishmentId, accountId, number: `FA-${year}-${String(seq).padStart(4, "0")}`, year, seq, issuedAt: now,
        dueAt: new Date(now.getTime() + account.paymentTermsDays * 86_400_000), totalTtc: lines.reduce((s, l) => s + l.ttc, 0), totalTax: taxes.reduce((s, t) => s + t.tax, 0),
        lines, taxes, buyer: { name: account.name, tahitiNumber: account.tahitiNumber, contactName: account.contactName, address: account.address, email: account.email },
        createdById: actor.userId,
      },
    });
    const upd = await tx.payment.updateMany({ where: { id: { in: billable.map((c) => c.id) }, invoiceId: null }, data: { invoiceId: inv.id } });
    if (upd.count !== billable.length) throw new ApiError(409, "CONFLICT", "Facturation simultanée : recommencez");
    await audit({ ...actor, action: "account.invoice", entityType: "account_invoice", entityId: inv.id, newValue: { number: inv.number, account: account.name, totalTtc: inv.totalTtc, lines: lines.length } }, tx);
    return inv;
  });
  return invoice;
}

// ─── Règlements ───

export async function recordSettlement(actor: Actor, accountId: string, input: { amount: number; method: SettlementMethod; reference?: string | null; note?: string | null }, now = new Date()) {
  const account = await prisma.customerAccount.findFirst({ where: { id: accountId, establishmentId: actor.establishmentId } });
  if (!account) throw new ApiError(404, "NOT_FOUND", "Compte client introuvable");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new ApiError(400, "BAD_AMOUNT", "Montant invalide");
  // Règlement en espèces : il entre dans le tiroir, donc dans la session de caisse ouverte
  const session = input.method === "CASH" ? await findOpenSession(actor.establishmentId, actor.terminalId ?? null) : null;
  if (input.method === "CASH" && !session) throw new ApiError(409, "NO_CASH_SESSION", "Ouvrez une session de caisse pour recevoir un règlement en espèces");
  const s = await prisma.$transaction(async (tx) => {
    const created = await tx.accountSettlement.create({ data: { establishmentId: actor.establishmentId, accountId, amount: input.amount, method: input.method, reference: input.reference?.trim() || null, note: input.note?.trim() || null, receivedAt: now, userId: actor.userId, cashSessionId: session?.id ?? null } });
    if (session) await tx.cashMovement.create({ data: { cashSessionId: session.id, userId: actor.userId, kind: "PAY_IN", amount: input.amount, reason: `Règlement compte ${account.name}` } });
    await audit({ ...actor, action: "account.settlement", entityType: "customer_account", entityId: accountId, newValue: { amount: input.amount, method: input.method, reference: created.reference } }, tx);
    return created;
  });
  if (session) publish("cash.updated", actor.establishmentId, { cashSessionId: session.id });
  return s;
}

// ─── Factures : document et relance ───

export async function getInvoice(establishmentId: string, id: string) {
  const inv = await prisma.accountInvoice.findFirst({ where: { id, establishmentId }, include: { establishment: { select: { name: true, legalName: true, addressLine1: true, addressLine2: true, postalCode: true, city: true, island: true, phone: true, email: true, tahitiNumber: true, timezone: true, currency: true } } } });
  if (!inv) throw new ApiError(404, "NOT_FOUND", "Facture introuvable");
  const t = await totals(prisma, inv.accountId);
  const all = await prisma.accountInvoice.findMany({ where: { accountId: inv.accountId }, select: { id: true, totalTtc: true, issuedAt: true, dueAt: true } });
  const st = invoiceStatuses(all, t.settled, new Date()).invoices.find((i) => i.id === inv.id)!;
  return { ...inv, lines: inv.lines as unknown as InvoiceLine[], taxes: inv.taxes as unknown as TaxRow[], buyer: inv.buyer as { name: string; tahitiNumber: string | null; contactName: string | null; address: string | null; email: string | null }, paid: st.paid, remaining: st.remaining, status: st.status };
}

/** Facture au format PDF (A4), pour le téléchargement et l'envoi par e-mail. */
export async function renderInvoicePdf(establishmentId: string, id: string): Promise<{ pdf: Buffer; number: string }> {
  const inv = await getInvoice(establishmentId, id);
  const e = inv.establishment, tz = e.timezone;
  const strip = (ch: string) => ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const safe = (s: string) => [...s].map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : /^[\x20-\x7e\xa0-\xff]$/.test(strip(ch)) ? strip(ch) : "")).join("");
  const money = (n: number) => safe(formatMoney(n, e.currency));
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margins: { top: 40, bottom: 40, left: 40, right: 40 }, info: { Title: `Facture ${inv.number}`, Author: e.legalName || e.name } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = 515, L = 40, BRAND = "#0d8a86", INK = "#0f172a", MUTED = "#64748b";

  doc.rect(0, 0, 595, 96).fill(BRAND);
  doc.fillColor("#fff").font("Helvetica-Bold").fontSize(18).text(safe(e.legalName || e.name), L, 28, { width: 300 });
  doc.font("Helvetica").fontSize(8.5).fillColor("#d3f7f2");
  const seller = [e.legalName && e.legalName !== e.name ? e.name : null, e.addressLine1, e.addressLine2, [e.postalCode, e.city].filter(Boolean).join(" "), e.island, e.phone ? `Tél. ${e.phone}` : null, e.email, e.tahitiNumber ? `N° Tahiti ${e.tahitiNumber}` : null].filter(Boolean) as string[];
  doc.text(safe(seller.join(" · ")), L, 52, { width: 330 });
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#fff").text("FACTURE", 380, 28, { width: 175, align: "right" });
  doc.fontSize(16).text(safe(inv.number), 380, 42, { width: 175, align: "right" });
  doc.font("Helvetica").fontSize(9).fillColor("#d3f7f2").text(safe(`Émise le ${formatDate(inv.issuedAt, tz)}`), 380, 64, { width: 175, align: "right" });

  // Client
  let y = 120;
  doc.roundedRect(L + W - 250, y, 250, 86, 8).fill("#f1f4f8");
  doc.fillColor(MUTED).font("Helvetica").fontSize(8).text("FACTURÉ À", L + W - 238, y + 10);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(safe(inv.buyer.name), L + W - 238, y + 22, { width: 226 });
  doc.font("Helvetica").fontSize(9).fillColor(INK);
  const buyer = [inv.buyer.contactName ? `À l'attention de ${inv.buyer.contactName}` : null, inv.buyer.address, inv.buyer.tahitiNumber ? `N° Tahiti ${inv.buyer.tahitiNumber}` : null].filter(Boolean) as string[];
  doc.text(safe(buyer.join("\n")), L + W - 238, y + 38, { width: 226 });
  doc.fillColor(MUTED).fontSize(9).text(safe(`Échéance : ${formatDate(inv.dueAt, tz)}`), L, y + 10);
  doc.text(safe(`${inv.lines.length} consommation${inv.lines.length > 1 ? "s" : ""}`), L, y + 24);

  // Lignes
  y = 226;
  doc.rect(L, y, W, 18).fill("#f1f4f8");
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(8.5).text("Date", L + 8, y + 5).text("Désignation", L + 90, y + 5).text("HT", L + 330, y + 5, { width: 80, align: "right" }).text("TTC", L + 420, y + 5, { width: 87, align: "right" });
  y += 22;
  doc.font("Helvetica").fontSize(8.5);
  for (const l of inv.lines) {
    if (y > 700) { doc.addPage(); y = 50; }
    const ht = l.taxes.reduce((s, t) => s + t.ht, 0);
    doc.fillColor(INK).text(safe(formatDate(l.date, tz)), L + 8, y).text(safe(l.label), L + 90, y, { width: 235 }).text(money(ht), L + 330, y, { width: 80, align: "right" }).text(money(l.ttc), L + 420, y, { width: 87, align: "right" });
    y += 16;
    doc.moveTo(L, y - 3).lineTo(L + W, y - 3).strokeColor("#e4e9ef").lineWidth(0.5).stroke();
  }

  // TVA et totaux
  y += 10;
  if (y > 640) { doc.addPage(); y = 50; }
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(MUTED).text("TVA", L, y);
  y += 14;
  doc.font("Helvetica").fillColor(INK);
  for (const t of inv.taxes) { doc.text(safe(`${t.name} : base HT ${formatMoney(t.ht, e.currency)} · TVA ${formatMoney(t.tax, e.currency)}`), L, y, { width: 280 }); y += 13; }
  const totalHt = inv.totalTtc - inv.totalTax;
  let ty = y - inv.taxes.length * 13 - 14;
  const row = (label: string, value: string, bold = false) => { doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 9).fillColor(bold ? BRAND : INK).text(safe(label), L + 300, ty, { width: 110 }).text(value, L + 410, ty, { width: 97, align: "right" }); ty += bold ? 20 : 14; };
  row("Total HT", money(totalHt));
  row("TVA", money(inv.totalTax));
  row("Total TTC", money(inv.totalTtc), true);
  if (inv.paid > 0) { row("Déjà réglé", money(inv.paid)); row("Reste à payer", money(inv.remaining), true); }
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(safe(`Facture à régler avant le ${formatDate(inv.dueAt, tz)}. Merci de rappeler le numéro ${inv.number} avec votre règlement.`), L, 760, { width: W, align: "center" });
  doc.end();
  return { pdf: await done, number: inv.number };
}

/** Relance par e-mail d'une facture non réglée, avec la facture en PDF. */
export async function remindInvoice(actor: Actor, id: string, now = new Date()) {
  const inv = await getInvoice(actor.establishmentId, id);
  if (inv.remaining <= 0) throw new ApiError(409, "INVOICE_PAID", "Cette facture est déjà réglée");
  await assertNotDemoEmail(actor.organizationId); // restaurant exemple : jamais d'e-mail réel
  const account = await prisma.customerAccount.findUniqueOrThrow({ where: { id: inv.accountId } });
  if (!account.email) throw new ApiError(400, "NO_EMAIL", `Aucun e-mail pour « ${account.name} » : ajoutez-le dans la fiche du compte`);
  const { isEmailConfigured, sendMail, invoiceReminderMail } = await import("@/server/email/mailer");
  if (!isEmailConfigured()) throw new ApiError(503, "EMAIL_NOT_CONFIGURED", "L'envoi d'e-mails n'est pas configuré sur ce serveur");
  const { pdf } = await renderInvoicePdf(actor.establishmentId, id);
  const e = inv.establishment;
  await sendMail(invoiceReminderMail({
    to: account.email, establishmentName: e.legalName || e.name, number: inv.number, issued: formatDate(inv.issuedAt, e.timezone), due: formatDate(inv.dueAt, e.timezone),
    total: formatMoney(inv.totalTtc, e.currency), remaining: formatMoney(inv.remaining, e.currency), overdue: inv.status === "OVERDUE", phone: e.phone, replyTo: e.email, pdf,
  }));
  await prisma.accountInvoice.update({ where: { id }, data: { remindedAt: now, reminderCount: { increment: 1 } } });
  await audit({ ...actor, action: "account.reminder", entityType: "account_invoice", entityId: id, newValue: { number: inv.number, to: account.email, remaining: inv.remaining } });
  return { sentTo: account.email };
}

/** Factures en retard (tous comptes) : pour le tableau de bord des comptes. */
export async function overdueSummary(establishmentId: string, now = new Date()) {
  const list = await listAccounts(establishmentId, now);
  return { count: list.filter((a) => a.overdue > 0).length, amount: list.reduce((s, a) => s + a.overdue, 0) };
}
