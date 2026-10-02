/**
 * Restaurant exemple : cartes cadeaux vendues et clients inscrits aux offres (avec leur anniversaire), pour
 * essayer les cartes à la caisse et voir les segments de campagne. Créé une seule fois ; aucun e-mail n'est envoyé
 * depuis la démo.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { addDays, startOfLocalDay } from "../src/lib/dates";
import type { DemoCtx } from "./demo-activity";

const CARDS = [
  { code: "DEMO-5000", amount: 5000, method: "CARD", buyerName: "Hinano", recipientName: "Teva", message: "Joyeux anniversaire !", daysAgo: 12 },
  { code: "DEMO-10K0", amount: 10000, method: "CASH", buyerName: "Famille Tetuanui", recipientName: "Maeva", message: "Pour un bon dîner en amoureux", daysAgo: 5 },
  { code: "DEMO-3000", amount: 3000, method: "OFFERED", buyerName: null, recipientName: "Gagnant du jeu Facebook", message: null, daysAgo: 2 },
];

export async function marketingDemo(prisma: PrismaClient, ctx: DemoCtx, today: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { options: true } });
  if (!org.options.includes("marketing")) await prisma.organization.update({ where: { id: ctx.orgId }, data: { options: [...org.options, "marketing"] } });
  if (await prisma.giftCard.count({ where: { establishmentId: ctx.estId } })) return 0;
  for (const c of CARDS) {
    await prisma.giftCard.create({ data: { establishmentId: ctx.estId, code: c.code, initialAmount: c.amount, balance: c.amount, buyerName: c.buyerName, recipientName: c.recipientName, message: c.message, saleMethod: c.method, soldById: ctx.managerId, createdAt: startOfLocalDay(addDays(today, -c.daysAgo), ctx.tz), expiresAt: startOfLocalDay(addDays(today, 365 - c.daysAgo), ctx.tz) } });
  }
  // Deux clients sur trois ont accepté les offres ; anniversaires répartis sur l'année (dont le mois en cours)
  const customers = await prisma.customer.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "asc" }, select: { id: true, email: true } });
  const month = Number(today.slice(5, 7));
  for (const [i, c] of customers.entries()) {
    const m = ((month - 1 + i * 5) % 12) + 1;
    await prisma.customer.update({ where: { id: c.id }, data: { birthday: `${String(m).padStart(2, "0")}-${String((i * 7) % 28 + 1).padStart(2, "0")}`, ...(c.email && i % 3 !== 2 ? { marketingConsent: true, consentAt: startOfLocalDay(addDays(today, -30), ctx.tz) } : {}) } });
  }
  return CARDS.length;
}
