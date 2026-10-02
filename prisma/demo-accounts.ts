/**
 * Restaurant exemple : comptes clients pro (fictifs) avec des consommations « sur compte » et un règlement,
 * pour essayer la facturation. Créés une seule fois ; les visiteurs facturent et encaissent eux-mêmes.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { addDays, localDay, startOfLocalDay } from "../src/lib/dates";
import type { DemoCtx } from "./demo-activity";

const ACCOUNTS = [
  { name: "Entreprise Lagon Bleu (exemple)", contactName: "Service comptable", email: "compta@exemple.pf", creditLimit: 150000, paymentTermsDays: 30, address: "Zone industrielle, Faa'a" },
  { name: "Cabinet Horizon (exemple)", contactName: "Accueil", email: "contact@exemple.pf", creditLimit: 80000, paymentTermsDays: 15, address: "Centre-ville, Papeete" },
  { name: "Club de va'a (exemple)", contactName: "Trésorier", email: null, creditLimit: null, paymentTermsDays: 30, address: null },
];

export async function accountsDemo(prisma: PrismaClient, ctx: DemoCtx, today: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { options: true } });
  if (!org.options.includes("accounts")) await prisma.organization.update({ where: { id: ctx.orgId }, data: { options: [...org.options, "accounts"] } });
  if (await prisma.customerAccount.count({ where: { establishmentId: ctx.estId } })) return 0;
  const created = [];
  for (const a of ACCOUNTS) created.push(await prisma.customerAccount.create({ data: { establishmentId: ctx.estId, ...a } }));

  // Quelques déjeuners des trois dernières semaines, réglés par carte, passent « sur compte »
  const payments = await prisma.payment.findMany({
    where: { establishmentId: ctx.estId, method: "CARD", status: "COMPLETED", amount: { gte: 3000, lte: 20000 }, order: { type: "DINE_IN" }, createdAt: { gte: startOfLocalDay(addDays(today, -21), ctx.tz), lt: startOfLocalDay(today, ctx.tz) } },
    orderBy: { createdAt: "asc" }, take: 400, select: { id: true, amount: true, createdAt: true },
  }).then((all) => {
    // Un déjeuner tous les deux jours environ, pas tous le même jour
    const days = new Set<string>();
    return all.filter((p) => { const d = localDay(p.createdAt, ctx.tz); if (days.has(d) || days.size >= 9 || Number(d.slice(-2)) % 2) return false; days.add(d); return true; });
  });
  for (const [i, p] of payments.entries()) {
    await prisma.payment.update({ where: { id: p.id }, data: { method: "ACCOUNT", customerAccountId: created[i % 2].id, reference: null } });
  }
  // Un acompte reçu par virement
  const second = payments.filter((_, i) => i % 2 === 1).reduce((s, p) => s + p.amount, 0);
  if (second > 0) await prisma.accountSettlement.create({ data: { establishmentId: ctx.estId, accountId: created[1].id, amount: Math.floor(second / 2 / 100) * 100, method: "TRANSFER", reference: "Virement (exemple)", receivedAt: startOfLocalDay(addDays(today, -3), ctx.tz), userId: ctx.managerId } });
  return payments.length;
}
