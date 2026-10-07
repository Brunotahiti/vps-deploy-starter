import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { endOfLocalDay, startOfLocalDay } from "@/lib/dates";
import { EXPENSE_METHODS, expenseAccount, expenseCategoryLabel, isExpenseCategory, type ExpenseMethod } from "@/lib/accounting";
import { getPeriodReport } from "./reports";
import { staffSummary } from "./staff";
import type { Actor } from "./orders";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Comptabilité de l'établissement : les ventes et encaissements viennent de la caisse, les achats des réceptions
 * de stock, les dépenses (loyer, énergie, factures hors bons de commande…) sont saisies ici. On en tire la TVA
 * (collectée − déductible), un compte de résultat simplifié et les exports pour le comptable.
 */
const n = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? 0 : Number(d));

export type ExpenseInput = { date: string; label: string; category: string; supplierId?: string | null; supplierName?: string | null; reference?: string | null; amountTtc: number; taxAmount?: number; method?: ExpenseMethod | null; paidAt?: string | null; notes?: string | null };

/** Date d'une pièce : un jour « AAAA-MM-JJ » est pris à midi dans le fuseau de l'établissement (jamais la veille en UTC). */
function parseDate(value: string, timezone: string) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(startOfLocalDay(value, timezone).getTime() + 12 * 3600_000) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, "BAD_DATE", "Date invalide");
  return date;
}

function validateExpense(input: ExpenseInput, timezone: string) {
  if (!isExpenseCategory(input.category)) throw new ApiError(400, "BAD_CATEGORY", "Catégorie de dépense inconnue");
  if (input.amountTtc <= 0) throw new ApiError(400, "BAD_AMOUNT", "Le montant doit être positif");
  if ((input.taxAmount ?? 0) < 0 || (input.taxAmount ?? 0) > input.amountTtc) throw new ApiError(400, "BAD_TAX", "La TVA ne peut pas dépasser le montant TTC");
  if (input.method && !EXPENSE_METHODS.includes(input.method)) throw new ApiError(400, "BAD_METHOD", "Moyen de paiement inconnu");
  return parseDate(input.date, timezone);
}

const expenseInclude = { supplier: { select: { id: true, name: true } }, user: { select: { firstName: true, displayName: true } } } satisfies Prisma.ExpenseInclude;
function mapExpense(e: Prisma.ExpenseGetPayload<{ include: typeof expenseInclude }>) {
  return { ...e, amountHt: e.amountTtc - e.taxAmount, categoryLabel: expenseCategoryLabel(e.category), account: expenseAccount(e.category), paid: !!e.method };
}

export async function listExpenses(establishmentId: string, from: Date, to: Date) {
  const rows = await prisma.expense.findMany({ where: { establishmentId, date: { gte: from, lt: to } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], include: expenseInclude });
  return rows.map(mapExpense);
}

export async function upsertExpense(actor: Actor, input: ExpenseInput & { id?: string }) {
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { timezone: true } });
  const date = validateExpense(input, est.timezone);
  if (input.supplierId && !(await prisma.supplier.findFirst({ where: { id: input.supplierId, establishmentId: actor.establishmentId } }))) throw new ApiError(400, "BAD_SUPPLIER", "Fournisseur inconnu");
  const supplierName = input.supplierName?.trim() || (input.supplierId ? (await prisma.supplier.findUnique({ where: { id: input.supplierId }, select: { name: true } }))?.name ?? null : null);
  // Payée : la date de paiement par défaut est la date de la pièce
  const paidAt = input.method ? (input.paidAt ? parseDate(input.paidAt, est.timezone) : date) : null;
  const data = { date, label: input.label.trim(), category: input.category, supplierId: input.supplierId ?? null, supplierName, reference: input.reference?.trim() || null, amountTtc: Math.round(input.amountTtc), taxAmount: Math.round(input.taxAmount ?? 0), method: input.method ?? null, paidAt, notes: input.notes?.trim() || null };
  if (input.id) {
    const existing = await prisma.expense.findFirst({ where: { id: input.id, establishmentId: actor.establishmentId } });
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Dépense introuvable");
    const row = await prisma.expense.update({ where: { id: input.id }, data, include: expenseInclude });
    await audit({ ...actor, action: "expense.update", entityType: "expense", entityId: row.id, oldValue: { label: existing.label, amountTtc: existing.amountTtc, category: existing.category }, newValue: { label: row.label, amountTtc: row.amountTtc, category: row.category } });
    return mapExpense(row);
  }
  const row = await prisma.expense.create({ data: { ...data, establishmentId: actor.establishmentId, userId: actor.userId }, include: expenseInclude });
  await audit({ ...actor, action: "expense.create", entityType: "expense", entityId: row.id, newValue: { label: row.label, amountTtc: row.amountTtc, category: row.category } });
  return mapExpense(row);
}

export async function deleteExpense(actor: Actor, id: string) {
  const existing = await prisma.expense.findFirst({ where: { id, establishmentId: actor.establishmentId } });
  if (!existing) throw new ApiError(404, "NOT_FOUND", "Dépense introuvable");
  await prisma.expense.delete({ where: { id } });
  await audit({ ...actor, action: "expense.delete", entityType: "expense", entityId: id, oldValue: { label: existing.label, amountTtc: existing.amountTtc } });
}

export type AccountingSummary = Awaited<ReturnType<typeof getAccountingSummary>>;

/** Synthèse comptable d'une période : ventes, TVA, encaissements, achats, dépenses, personnel, résultat. */
export async function getAccountingSummary(establishmentId: string, fromDay: string, toDay: string, timezone: string, opts: { withStaff?: boolean } = {}) {
  const from = startOfLocalDay(fromDay, timezone), to = endOfLocalDay(toDay, timezone);
  const [report, orders, refunds, purchaseMoves, expenses, cashOut] = await Promise.all([
    getPeriodReport(establishmentId, fromDay, toDay, timezone, false),
    prisma.order.findMany({ where: { establishmentId, status: "PAID", closedAt: { gte: from, lt: to } }, select: { items: { where: { status: { not: "VOIDED" } }, select: { lineTotal: true, taxAmount: true, taxRateBps: true, taxRateName: true } }, subtotal: true, total: true } }),
    prisma.refund.findMany({ where: { payment: { establishmentId }, createdAt: { gte: from, lt: to } }, select: { amount: true, payment: { select: { method: true, order: { select: { total: true, taxTotal: true } } } } } }),
    prisma.inventoryMovement.findMany({ where: { establishmentId, kind: "PURCHASE", createdAt: { gte: from, lt: to } }, select: { quantity: true, unitCost: true, reason: true, referenceId: true, ingredient: { select: { name: true } } } }),
    listExpenses(establishmentId, from, to),
    prisma.cashMovement.findMany({ where: { cashSession: { establishmentId }, kind: "PAY_OUT", createdAt: { gte: from, lt: to } }, select: { amount: true, reason: true, createdAt: true } }),
  ]);

  // Ventes par taux de TVA (remise globale répartie au prorata, comme l'export comptable)
  const byRate = new Map<string, { rateBps: number; name: string; ht: number; tax: number; ttc: number }>();
  for (const o of orders) {
    const ratio = o.subtotal > 0 ? o.total / o.subtotal : 1;
    for (const it of o.items) {
      const ttc = Math.round(it.lineTotal * ratio), tax = Math.round(it.taxAmount * ratio);
      const k = `${it.taxRateBps}|${it.taxRateName ?? ""}`;
      const e = byRate.get(k) ?? { rateBps: it.taxRateBps, name: it.taxRateName ?? `${it.taxRateBps / 100} %`, ht: 0, tax: 0, ttc: 0 };
      e.ttc += ttc; e.tax += tax; e.ht += ttc - tax; byRate.set(k, e);
    }
  }
  const refundTtc = refunds.reduce((a, r) => a + r.amount, 0);
  const refundTax = refunds.reduce((a, r) => a + (r.payment.order.total > 0 ? Math.round((r.amount * r.payment.order.taxTotal) / r.payment.order.total) : 0), 0);

  // Achats : réceptions de bons de commande et achats directs saisis dans le stock, au coût d'entrée
  const purchasesStock = purchaseMoves.reduce((a, m) => a + Math.round(Math.abs(n(m.quantity)) * (m.unitCost ?? 0)), 0);
  const purchasesViaOrders = purchaseMoves.filter((m) => m.referenceId).reduce((a, m) => a + Math.round(Math.abs(n(m.quantity)) * (m.unitCost ?? 0)), 0);

  // Dépenses saisies, par catégorie
  const byCategory = new Map<string, { category: string; label: string; account: string; ttc: number; ht: number; tax: number; count: number; unpaid: number }>();
  for (const e of expenses) {
    const c = byCategory.get(e.category) ?? { category: e.category, label: e.categoryLabel, account: e.account, ttc: 0, ht: 0, tax: 0, count: 0, unpaid: 0 };
    c.ttc += e.amountTtc; c.ht += e.amountHt; c.tax += e.taxAmount; c.count++; if (!e.paid) c.unpaid += e.amountTtc; byCategory.set(e.category, c);
  }
  const expensesTtc = expenses.reduce((a, e) => a + e.amountTtc, 0);
  const expensesTax = expenses.reduce((a, e) => a + e.taxAmount, 0);
  const expensesHt = expensesTtc - expensesTax;
  const expensesUnpaid = expenses.filter((e) => !e.paid).reduce((a, e) => a + e.amountTtc, 0);

  // Personnel pointé (option Équipe) : coût des heures travaillées, si l'option est ouverte
  let laborCost: number | null = null;
  if (opts.withStaff) { try { laborCost = (await staffSummary(establishmentId, fromDay, toDay, timezone)).totalCost; } catch { laborCost = null; } }
  // Les dépenses « Personnel » saisies à la main complètent le pointage (extras, charges) : comptées une fois dans le résultat
  const staffExpenses = byCategory.get("STAFF")?.ht ?? 0;

  const revenueHt = report.revenueHt - (refundTtc - refundTax);
  const taxCollected = report.tax - refundTax;
  const charges = purchasesStock + expensesHt + (laborCost ?? 0);
  const result = revenueHt - charges;
  return {
    from: fromDay, to: toDay, days: report.days,
    sales: { ttc: report.revenue, ht: report.revenueHt, tax: report.tax, tickets: report.tickets, covers: report.covers, discounts: report.discounts, tips: report.tips, refundsTtc: refundTtc, refundsTax: refundTax, netTtc: report.revenue - refundTtc, netHt: revenueHt, byRate: [...byRate.values()].sort((a, b) => a.rateBps - b.rateBps) },
    receipts: report.byMethod,
    purchases: { stock: purchasesStock, viaOrders: purchasesViaOrders, direct: purchasesStock - purchasesViaOrders, movements: purchaseMoves.length },
    expenses: { ttc: expensesTtc, ht: expensesHt, tax: expensesTax, unpaid: expensesUnpaid, count: expenses.length, byCategory: [...byCategory.values()].sort((a, b) => b.ttc - a.ttc), staffHt: staffExpenses },
    vat: { collected: taxCollected, deductible: expensesTax, due: taxCollected - expensesTax },
    staff: { laborCost },
    cashOut: { total: cashOut.reduce((a, m) => a + Math.abs(m.amount), 0), count: cashOut.length },
    result: { revenueHt, purchases: purchasesStock, expensesHt, laborCost: laborCost ?? 0, charges, result, marginPct: revenueHt > 0 ? Math.round((result / revenueHt) * 1000) / 10 : null, foodCostPct: revenueHt > 0 ? Math.round((purchasesStock / revenueHt) * 1000) / 10 : null },
  };
}
