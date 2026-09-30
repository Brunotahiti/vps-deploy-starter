import { route, ok, parseQuery, parseBody, created } from "@/server/http";
import { requireApiKey } from "@/server/api-keys";
import { apiOrdersQuery, publicLineSchema } from "@/server/schemas";
import { listOrders, createOrder, addItem, getOrder } from "@/server/services/orders";
import { endOfLocalDay, startOfLocalDay, localDay } from "@/lib/dates";
import { prisma } from "@/server/db";
import { z } from "zod";

/** API publique v1 — commandes clôturées ou en cours (`?from&to&status&take&skip`). */
export const GET = route(async (req) => {
  const ctx = await requireApiKey(req, "orders:read");
  const q = parseQuery(req, apiOrdersQuery);
  const tz = ctx.establishment.timezone;
  const from = q.from ?? localDay(new Date(), tz), to = q.to ?? from;
  const r = await listOrders(ctx.establishmentId, { status: q.status, from: startOfLocalDay(from, tz), to: endOfLocalDay(to, tz), take: q.take ?? 100, skip: q.skip });
  return ok({ total: r.total, items: r.items.map(publicOrder) });
});

/** Création d'une commande par un canal partenaire (type ONLINE, à accepter en caisse). */
export const POST = route(async (req) => {
  const ctx = await requireApiKey(req, "orders:write");
  const body = await parseBody(req, z.object({ id: z.string().uuid().optional(), customerName: z.string().max(80).nullable().optional(), notes: z.string().max(300).nullable().optional(), lines: z.array(publicLineSchema).min(1).max(60) }));
  const owner = await prisma.user.findFirst({ where: { organizationId: ctx.organizationId, isOwner: true, isActive: true } });
  if (!owner) return ok({ error: "NO_OWNER" }, { status: 500 });
  const actor = { organizationId: ctx.organizationId, establishmentId: ctx.establishmentId, userId: owner.id };
  const order = await createOrder(actor, { id: body.id, type: "ONLINE", customerName: body.customerName ?? null, notes: body.notes ?? null });
  for (const l of body.lines) await addItem(actor, order.id, { ...l, courseId: order.courses[0]?.id ?? null });
  await prisma.order.update({ where: { id: order.id }, data: { channelMeta: { channel: "API", apiKeyId: ctx.keyId, awaitingAcceptance: true } } });
  return created(publicOrder(await getOrder(ctx.establishmentId, order.id)));
});

export function publicOrder(o: Awaited<ReturnType<typeof getOrder>>) {
  return { id: o.id, number: o.number, type: o.type, status: o.status, table: o.table?.name ?? null, covers: o.covers, customerName: o.customerName, openedAt: o.openedAt, closedAt: o.closedAt, subtotal: o.subtotal, discountTotal: o.discountTotal, taxTotal: o.taxTotal, total: o.total, paidTotal: o.paidTotal, tipTotal: o.tipTotal,
    items: o.items.filter((i) => i.status !== "VOIDED").map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal, taxRateBps: i.taxRateBps, status: i.status, parentItemId: i.parentItemId, modifiers: i.modifiers.map((m) => ({ name: m.name, priceDelta: m.priceDelta })) })),
    payments: o.payments.filter((p) => p.status !== "VOIDED").map((p) => ({ id: p.id, method: p.method, amount: p.amount, refundedAmount: p.refundedAmount, reference: p.reference, createdAt: p.createdAt })) };
}
