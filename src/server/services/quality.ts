import { z } from "zod";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { aiStructured, isAiConfigured } from "@/server/ai/claude";
import { addDays, localDay, startOfLocalDay } from "@/lib/dates";
import type { Prisma } from "@/generated/prisma/client";
import type { Actor } from "./orders";

/**
 * Analyse qualité du restaurant, inspirée de la norme ISO 9001 (option Assistant IA).
 * Le programme mesure (ventes, annulations, remboursements, temps cuisine, rappels de service, absences aux
 * réservations, écarts de caisse, pertes), compare à la période précédente, puis Claude rédige l'analyse par
 * chapitre de la norme et un plan d'actions. Ce n'est pas une certification.
 */

const PERIOD_DAYS = 30;
const MAX_PER_DAY = 3; // analyses par jour et par établissement

type Range = { from: Date; to: Date };

async function measure(establishmentId: string, r: Range) {
  const paid = { establishmentId, status: "PAID" as const, closedAt: { gte: r.from, lt: r.to } };
  const [sales, dine, cancelled, voided, refunds, tickets, reminders, resas, cash, losses, customers] = await Promise.all([
    prisma.order.aggregate({ where: paid, _sum: { total: true }, _count: true }),
    prisma.order.aggregate({ where: { ...paid, type: "DINE_IN" }, _sum: { covers: true } }),
    prisma.order.aggregate({ where: { establishmentId, status: "CANCELLED", openedAt: { gte: r.from, lt: r.to } }, _sum: { total: true }, _count: true }),
    prisma.orderItem.aggregate({ where: { order: { establishmentId }, status: "VOIDED", voidedAt: { gte: r.from, lt: r.to } }, _sum: { lineTotal: true }, _count: true }),
    prisma.refund.aggregate({ where: { createdAt: { gte: r.from, lt: r.to }, payment: { order: { establishmentId } } }, _sum: { amount: true }, _count: true }),
    prisma.kitchenTicket.findMany({ where: { order: { establishmentId }, createdAt: { gte: r.from, lt: r.to }, readyAt: { not: null } }, select: { createdAt: true, readyAt: true }, take: 20000 }),
    prisma.serviceReminder.findMany({ where: { establishmentId, dueAt: { gte: r.from, lt: r.to }, status: "DONE" }, select: { dueAt: true, doneAt: true }, take: 20000 }),
    prisma.reservation.groupBy({ by: ["status"], where: { establishmentId, startsAt: { gte: r.from, lt: r.to } }, _count: true }),
    prisma.cashSession.findMany({ where: { establishmentId, status: "CLOSED", closedAt: { gte: r.from, lt: r.to } }, select: { difference: true } }),
    prisma.inventoryMovement.findMany({ where: { establishmentId, createdAt: { gte: r.from, lt: r.to }, kind: { in: ["LOSS", "BREAKAGE"] } }, select: { quantity: true, unitCost: true } }),
    prisma.order.findMany({ where: { ...paid, customerId: { not: null } }, select: { customerId: true }, take: 20000 }),
  ]);
  const prep = tickets.map((t) => (t.readyAt!.getTime() - t.createdAt.getTime()) / 60000).filter((m) => m >= 0 && m < 240);
  const lateReminders = reminders.filter((x) => x.doneAt && x.doneAt.getTime() - x.dueAt.getTime() > 5 * 60000).length;
  const resaCount = (s: string) => resas.find((x) => x.status === s)?._count ?? 0;
  const resaTotal = resas.reduce((a, x) => a + x._count, 0);
  const visits = new Map<string, number>();
  for (const c of customers) visits.set(c.customerId!, (visits.get(c.customerId!) ?? 0) + 1);
  const revenue = sales._sum.total ?? 0;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    ventes: { chiffreAffairesTTC: revenue, tickets: sales._count, panierMoyen: sales._count ? Math.round(revenue / sales._count) : 0, couverts: dine._sum.covers ?? 0 },
    annulations: { commandesAnnulees: cancelled._count, montantCommandesAnnulees: cancelled._sum.total ?? 0, articlesAnnules: voided._count, montantArticlesAnnules: voided._sum.lineTotal ?? 0, partDuCA: pct((voided._sum.lineTotal ?? 0) + (cancelled._sum.total ?? 0), revenue) },
    remboursements: { nombre: refunds._count, montant: refunds._sum.amount ?? 0, partDuCA: pct(refunds._sum.amount ?? 0, revenue) },
    cuisine: { bonsMesures: prep.length, tempsMoyenMin: prep.length ? Math.round((prep.reduce((a, b) => a + b, 0) / prep.length) * 10) / 10 : null, partPlusDe20Min: pct(prep.filter((m) => m > 20).length, prep.length) },
    service: { rappelsTraites: reminders.length, partEnRetardDePlusDe5Min: pct(lateReminders, reminders.length) },
    reservations: { total: resaTotal, absentsSansPrevenir: resaCount("NO_SHOW"), annulees: resaCount("CANCELLED"), tauxAbsence: pct(resaCount("NO_SHOW"), resaTotal) },
    caisse: { clotures: cash.length, cloturesAvecEcart: cash.filter((c) => (c.difference ?? 0) !== 0).length, ecartCumule: cash.reduce((a, c) => a + (c.difference ?? 0), 0), plusGrandEcart: cash.reduce((a, c) => Math.max(a, Math.abs(c.difference ?? 0)), 0) },
    pertesStock: { mouvements: losses.length, valeur: Math.round(losses.reduce((a, m) => a + Math.abs(Number(m.quantity)) * (m.unitCost ?? 0), 0)) },
    clients: { clientsIdentifies: visits.size, revenusDansLaPeriode: [...visits.values()].filter((v) => v > 1).length, tauxDeRetour: pct([...visits.values()].filter((v) => v > 1).length, visits.size) },
  };
}
export type QualityIndicators = Awaited<ReturnType<typeof measure>>;

export async function qualityIndicators(establishmentId: string, timezone: string, days = PERIOD_DAYS) {
  const today = localDay(new Date(), timezone);
  const current = { from: startOfLocalDay(addDays(today, -days), timezone), to: startOfLocalDay(today, timezone) };
  const previous = { from: startOfLocalDay(addDays(today, -2 * days), timezone), to: current.from };
  const [now, before] = await Promise.all([measure(establishmentId, current), measure(establishmentId, previous)]);
  return { period: { from: current.from.toISOString(), to: current.to.toISOString(), days }, current: now, previous: before };
}

const CLAUSES = ["4 · Contexte de l'organisation", "5 · Leadership", "6 · Planification", "7 · Support", "8 · Réalisation des opérations", "9 · Évaluation des performances", "10 · Amélioration"] as const;

export const QualityReportSchema = z.object({
  resume: z.string().describe("Synthèse en 3 à 5 phrases, ton bienveillant et concret"),
  score: z.number().int().min(0).max(100).describe("Note globale de maîtrise de la qualité sur 100"),
  pointsForts: z.array(z.string()).max(6),
  chapitres: z.array(z.object({
    chapitre: z.enum(CLAUSES),
    maturite: z.number().int().min(1).max(5).describe("1 = rien n'est en place, 5 = maîtrisé et amélioré en continu"),
    constat: z.string().describe("Ce que montrent les chiffres pour ce chapitre"),
  })).length(7),
  ecarts: z.array(z.object({
    titre: z.string(),
    preuve: z.string().describe("Chiffre ou fait mesuré qui le montre"),
    gravite: z.enum(["majeur", "mineur", "à surveiller"]),
  })).max(8),
  actions: z.array(z.object({
    action: z.string().describe("Action concrète, réalisable dans un restaurant"),
    pourquoi: z.string(),
    responsable: z.string().describe("Rôle : gérant, chef, responsable de salle, caissier…"),
    delai: z.string().describe("Ex. « cette semaine », « sous 15 jours »"),
    priorite: z.enum(["haute", "moyenne", "basse"]),
    indicateur: z.string().describe("Chiffre à suivre pour vérifier l'effet de l'action"),
  })).min(3).max(10),
  prochaineRevue: z.string().describe("Quand refaire le point, et sur quoi"),
});
export type QualityReport = z.infer<typeof QualityReportSchema>;

const SYSTEM = `Tu es auditeur qualité spécialisé en restauration, formé à la norme ISO 9001:2015.
Tu analyses un restaurant de Polynésie française à partir des chiffres mesurés par son logiciel de caisse ManaResto (montants en francs CFP, XPF).
Règles :
- Appuie chaque constat, écart et action sur les chiffres fournis ; n'invente aucun fait, aucun nom, aucun chiffre.
- Quand une donnée manque (0, null, aucune mesure), dis-le simplement et propose de la mesurer plutôt que de conclure.
- Compare la période à la précédente quand c'est utile.
- Les chapitres 4 à 7 (contexte, leadership, planification, support) sont peu visibles dans les chiffres : évalue-les avec prudence à partir des indices disponibles (régularité des clôtures, suivi des rappels, inventaires…).
- Écris en français simple, pour un restaurateur qui n'est pas spécialiste de la qualité : phrases courtes, pas de jargon.
- Les actions doivent être concrètes et réalisables par une petite équipe.
- Rappelle-toi que cette analyse s'inspire de l'ISO 9001 et ne vaut pas certification.`;

/** Réponse d'exemple (tests, démonstration sans clé) construite à partir des chiffres réels */
function exampleReport(ind: Awaited<ReturnType<typeof qualityIndicators>>): QualityReport {
  const c = ind.current;
  const late = c.cuisine.partPlusDe20Min ?? 0;
  return {
    resume: `Sur les ${ind.period.days} derniers jours : ${c.ventes.tickets} tickets et ${c.ventes.couverts} couverts. Les annulations représentent ${c.annulations.partDuCA ?? 0} % du chiffre d'affaires et ${late} % des bons dépassent 20 minutes en cuisine.`,
    score: Math.max(30, Math.min(90, Math.round(80 - late / 2 - (c.annulations.partDuCA ?? 0) * 2 - (c.reservations.tauxAbsence ?? 0)))),
    pointsForts: [c.caisse.clotures ? `${c.caisse.clotures} clôtures de caisse réalisées` : "Caisse utilisée au quotidien"],
    chapitres: CLAUSES.map((chapitre, i) => ({ chapitre, maturite: i >= 4 ? 3 : 2, constat: i === 4 ? `Temps moyen en cuisine : ${c.cuisine.tempsMoyenMin ?? "non mesuré"} min.` : "À préciser avec l'équipe." })),
    ecarts: late > 15 ? [{ titre: "Délais en cuisine", preuve: `${late} % des bons dépassent 20 minutes`, gravite: "mineur" }] : [],
    actions: [
      { action: "Faire un point de 10 minutes avant chaque service", pourquoi: "Anticiper les plats longs et les grosses tables", responsable: "Chef", delai: "cette semaine", priorite: "haute", indicateur: "Part des bons de plus de 20 min" },
      { action: "Appeler la veille les grandes tables réservées", pourquoi: "Limiter les absences sans prévenir", responsable: "Responsable de salle", delai: "dès maintenant", priorite: "moyenne", indicateur: "Taux d'absence aux réservations" },
      { action: "Noter le motif de chaque article annulé", pourquoi: "Comprendre les erreurs de prise de commande", responsable: "Serveurs", delai: "sous 15 jours", priorite: "moyenne", indicateur: "Montant des articles annulés" },
    ],
    prochaineRevue: "Dans 30 jours, sur les délais en cuisine et les absences aux réservations.",
  };
}

/** Rédige l'analyse (au plus 3 par jour et par établissement) et la garde dans l'historique */
export async function createQualityReport(actor: Actor, timezone: string) {
  if (!isAiConfigured()) throw new ApiError(503, "AI_NOT_CONFIGURED", "L'Assistant IA n'est pas encore branché sur ce serveur");
  const since = new Date(Date.now() - 24 * 3600_000);
  if ((await prisma.aiReport.count({ where: { establishmentId: actor.establishmentId, kind: "quality", createdAt: { gte: since } } })) >= MAX_PER_DAY) throw new ApiError(429, "AI_DAILY_LIMIT", `${MAX_PER_DAY} analyses qualité par jour au plus : la dernière reste disponible ci-dessous`);
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { name: true, businessType: true } });
  const ind = await qualityIndicators(actor.establishmentId, timezone);
  const prompt = `Établissement : ${est.name} (type : ${est.businessType}).
Période analysée : ${ind.period.days} derniers jours (du ${ind.period.from.slice(0, 10)} au ${ind.period.to.slice(0, 10)}), comparée aux ${ind.period.days} jours précédents.
Chiffres mesurés (JSON) :
${JSON.stringify({ periodeActuelle: ind.current, periodePrecedente: ind.previous }, null, 2)}

Rédige l'analyse qualité : synthèse, note sur 100, points forts, un constat et un niveau de maturité pour chacun des 7 chapitres (4 à 10) dans l'ordre, les écarts relevés, et un plan d'actions classé par priorité.`;
  const { data, model } = await aiStructured({ schema: QualityReportSchema, system: SYSTEM, prompt, fake: () => exampleReport(ind), effort: "medium" });
  const row = await prisma.aiReport.create({ data: { organizationId: actor.organizationId, establishmentId: actor.establishmentId, kind: "quality", periodFrom: new Date(ind.period.from), periodTo: new Date(ind.period.to), data: { report: data, indicators: ind } as unknown as Prisma.InputJsonValue, model, createdById: actor.userId } });
  await audit({ ...actor, action: "ai.quality_report", entityType: "ai_report", entityId: row.id, newValue: { score: data.score, model } });
  return { id: row.id, createdAt: row.createdAt, report: data, indicators: ind, model };
}

export async function listAiReports(establishmentId: string, kind: string, take = 10) {
  const rows = await prisma.aiReport.findMany({ where: { establishmentId, kind }, orderBy: { createdAt: "desc" }, take });
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, model: r.model, ...(r.data as Record<string, unknown>) }));
}
