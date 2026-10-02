/**
 * Restaurant exemple : événements traiteur fictifs pour essayer le parcours devis → acompte → facture.
 * Recréés seulement quand il n'y a plus d'événement à venir ; les plus anciens (plus de 90 jours) sont effacés.
 */
import { randomBytes } from "node:crypto";
import type { PrismaClient } from "../src/generated/prisma/client";
import { addDays, localDay, startOfLocalDay } from "../src/lib/dates";
import { eventTotals, type EventLine } from "../src/lib/catering";
import type { DemoCtx } from "./demo-activity";

const at = (ctx: DemoCtx, day: string, hour: number) => new Date(startOfLocalDay(day, ctx.tz).getTime() + hour * 3600_000);

export async function cateringDemo(prisma: PrismaClient, ctx: DemoCtx, today: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { options: true } });
  if (!org.options.includes("catering")) await prisma.organization.update({ where: { id: ctx.orgId }, data: { options: [...org.options, "catering"] } });
  const old = { establishmentId: ctx.estId, startsAt: { lt: startOfLocalDay(addDays(today, -90), ctx.tz) } };
  await prisma.cateringPayment.deleteMany({ where: { event: old } });
  await prisma.cateringEvent.deleteMany({ where: old });
  if (await prisma.cateringEvent.count({ where: { establishmentId: ctx.estId, startsAt: { gte: startOfLocalDay(today, ctx.tz) }, status: { not: "CANCELLED" } } })) return 0;

  // Lignes composées avec les plats de la carte de l'exemple (prix et TVA de la carte)
  const line = (p: { name: string; priceTtc: number; taxRateBps: number; taxRateName: string } | undefined, quantity: number): EventLine[] => (p ? [{ label: p.name, quantity, unitPrice: p.priceTtc, taxRateBps: p.taxRateBps, taxRateName: p.taxRateName }] : []);
  const tax13 = ctx.plats[0] ? { taxRateBps: ctx.plats[0].taxRateBps, taxRateName: ctx.plats[0].taxRateName } : { taxRateBps: 0, taxRateName: "TVA" };
  const year = Number(today.slice(0, 4));
  const lastQuote = (await prisma.cateringEvent.findFirst({ where: { establishmentId: ctx.estId, quoteYear: year }, orderBy: { quoteSeq: "desc" }, select: { quoteSeq: true } }))?.quoteSeq ?? 0;
  const lastInvoice = (await prisma.cateringEvent.findFirst({ where: { establishmentId: ctx.estId, invoiceYear: year }, orderBy: { invoiceSeq: "desc" }, select: { invoiceSeq: true } }))?.invoiceSeq ?? 0;
  const dv = (n: number) => ({ quoteNumber: `DV-${year}-${String(lastQuote + n).padStart(4, "0")}`, quoteYear: year, quoteSeq: lastQuote + n });

  const events = [
    {
      title: "Anniversaire de Mareva (exemple)", kind: "BUFFET", day: addDays(today, -6), from: 18, to: 23, guests: 25, privatize: false, clientName: "Mareva (exemple)",
      lines: [...line(ctx.entrees[0], 25), ...line(ctx.plats[0], 25), ...line(ctx.desserts[0], 25), ...line(ctx.boissons[0], 40)], status: "INVOICED", deposit: 0.3, paid: "all",
    },
    {
      title: "Repas de fin d'année (exemple)", kind: "CORPORATE", day: addDays(today, 9), from: 12, to: 15, guests: 30, privatize: false, clientName: "Service RH", clientCompany: "Entreprise Lagon Bleu (exemple)",
      lines: [...line(ctx.entrees[1] ?? ctx.entrees[0], 30), ...line(ctx.plats[1] ?? ctx.plats[0], 30), ...line(ctx.desserts[1] ?? ctx.desserts[0], 30)], status: "SENT", deposit: 0.3, paid: "none",
    },
    {
      title: "Mariage de Teva et Hina (exemple)", kind: "WEDDING", day: addDays(today, 24), from: 17, to: 23, guests: 60, privatize: true, clientName: "Teva (exemple)",
      lines: [...line(ctx.entrees[0], 60), ...line(ctx.plats[0], 60), ...line(ctx.desserts[0], 60), { label: "Privatisation de la salle et de la terrasse", quantity: 1, unitPrice: 50000, ...tax13 }],
      status: "ACCEPTED", deposit: 0.3, paid: "deposit",
    },
  ];
  let n = 0;
  for (const ev of events) {
    const t = eventTotals(ev.lines);
    if (!t.totalTtc) continue;
    n++;
    const deposit = Math.round((t.totalTtc * ev.deposit) / 1000) * 1000;
    const startsAt = at(ctx, ev.day, ev.from);
    const sentAt = new Date(startsAt.getTime() - 20 * 86_400_000);
    const created = await prisma.cateringEvent.create({ data: {
      establishmentId: ctx.estId, title: ev.title, kind: ev.kind, status: ev.status, startsAt, endsAt: at(ctx, ev.day, ev.to), guests: ev.guests, privatize: ev.privatize,
      clientName: ev.clientName, clientCompany: "clientCompany" in ev ? ev.clientCompany : null, clientEmail: null, lines: ev.lines, totalTtc: t.totalTtc, totalTax: t.totalTax, depositAmount: deposit,
      kitchenNotes: ev.kind === "WEDDING" ? "2 invités sans gluten. Gâteau apporté par la famille à 21 h." : null, publicToken: randomBytes(18).toString("base64url"),
      ...dv(n), quoteSentAt: sentAt, validUntil: new Date(sentAt.getTime() + 30 * 86_400_000), createdById: ctx.managerId,
      ...(ev.status !== "SENT" ? { acceptedAt: new Date(sentAt.getTime() + 3 * 86_400_000), acceptedBy: ev.clientName } : {}),
      ...(ev.status === "INVOICED" ? { invoiceNumber: `FT-${year}-${String(lastInvoice + 1).padStart(4, "0")}`, invoiceYear: year, invoiceSeq: lastInvoice + 1, invoicedAt: at(ctx, addDays(ev.day, 1), 10), invoiceDueAt: at(ctx, addDays(ev.day, 1), 10), invoice: { lines: ev.lines, taxes: t.taxes, buyer: { name: ev.clientName, company: null, tahitiNumber: null, address: null, email: null } } } : {}),
    } });
    const pay = (kind: string, amount: number, day: string, method: string) => prisma.cateringPayment.create({ data: { establishmentId: ctx.estId, eventId: created.id, kind, amount, method, receivedAt: at(ctx, day, 10), userId: ctx.managerId } });
    if (ev.paid !== "none") await pay("DEPOSIT", deposit, localDay(new Date(sentAt.getTime() + 4 * 86_400_000), ctx.tz), "TRANSFER");
    if (ev.paid === "all") await pay("BALANCE", t.totalTtc - deposit, addDays(ev.day, 2), "CHECK");
  }
  return n;
}
