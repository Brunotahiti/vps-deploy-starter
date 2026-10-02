import { z } from "zod";
import { prisma } from "@/server/db";
import { ApiError } from "@/server/errors";
import { audit } from "@/server/audit";
import { aiStructured, isAiConfigured } from "@/server/ai/claude";
import { addDays, localDay, startOfLocalDay } from "@/lib/dates";
import type { Prisma } from "@/generated/prisma/client";
import { forecast, LEVELS, type ForecastDay } from "./forecast";
import { createPurchaseOrder } from "./stock";
import type { Actor } from "./orders";

/* ------------------------------------------------------------------ Conseils de la semaine (rédigés par Claude) */

export const WeekAdviceSchema = z.object({
  titre: z.string().describe("Une phrase qui résume la semaine à venir"),
  jours: z.array(z.object({ jour: z.string().describe("AAAA-MM-JJ"), conseil: z.string().describe("Une phrase concrète pour ce jour") })).max(7),
  equipe: z.array(z.string()).max(5).describe("Conseils de planning de l'équipe"),
  miseEnPlace: z.array(z.string()).max(5).describe("Préparation, commandes, stock"),
  joursCalmes: z.array(z.string()).max(4).describe("Idées pour remplir les jours calmes"),
  vigilance: z.array(z.string()).max(4),
});
export type WeekAdvice = z.infer<typeof WeekAdviceSchema>;

const WEEK_SYSTEM = `Tu es le bras droit d'un restaurateur de Polynésie française. À partir des prévisions de fréquentation calculées par son logiciel ManaResto (façon Bison Futé : vert calme, orange soutenu, rouge chargé, noir très chargé) et des réservations déjà prises, tu donnes des conseils concrets pour la semaine.
Règles : appuie-toi uniquement sur les chiffres fournis ; n'invente ni événement, ni météo, ni nom ; phrases courtes et chaleureuses, en français simple ; pas de jargon.`;

const MAX_WEEK_PER_DAY = 5;

export async function weekAdvice(actor: Actor, timezone: string) {
  if (!isAiConfigured()) throw new ApiError(503, "AI_NOT_CONFIGURED", "L'Assistant IA n'est pas encore branché sur ce serveur");
  if ((await prisma.aiReport.count({ where: { establishmentId: actor.establishmentId, kind: "week", createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } })) >= MAX_WEEK_PER_DAY) throw new ApiError(429, "AI_DAILY_LIMIT", "Conseils déjà demandés plusieurs fois aujourd'hui : les derniers restent affichés");
  const f = await forecast(actor.establishmentId, timezone, 7);
  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: actor.establishmentId }, select: { name: true, businessType: true } });
  const days = f.days.map((d) => ({ jour: d.day, jourSemaine: new Intl.DateTimeFormat("fr-FR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${d.day}T12:00:00Z`)), niveau: d.closed ? "fermé" : LEVELS[d.level].label, clientsAttendus: d.expected.clients, midi: d.expected.lunch, soir: d.expected.dinner, aEmporter: d.expected.takeaway, reservations: d.booked.reservations, couvertsReserves: d.booked.covers, habituel: d.usual, fiabilite: d.confidence }));
  const prompt = `Établissement : ${est.name} (type : ${est.businessType}). Historique utilisé : ${f.historyDays} journées, tendance ${f.trend} (1 = stable). Une grosse journée habituelle ≈ ${f.reference} clients.
Prévisions des 7 prochains jours (JSON) :
${JSON.stringify(days, null, 2)}

Donne un titre, un conseil par jour ouvert, puis des conseils pour l'équipe, la mise en place, les jours calmes et les points de vigilance.`;
  const fake = (): WeekAdvice => ({
    titre: `Semaine ${f.days.some((d) => d.level === "red" || d.level === "black") ? "avec des pics à préparer" : "plutôt régulière"}`,
    jours: f.days.filter((d) => !d.closed).map((d) => ({ jour: d.day, conseil: d.advice })),
    equipe: ["Renforcez la salle les jours rouges et noirs"], miseEnPlace: ["Vérifiez le stock la veille des jours chargés"], joursCalmes: ["Proposez une formule du jour les jours verts"], vigilance: [],
  });
  const { data, model } = await aiStructured({ schema: WeekAdviceSchema, system: WEEK_SYSTEM, prompt, fake, effort: "low" });
  const row = await prisma.aiReport.create({ data: { organizationId: actor.organizationId, establishmentId: actor.establishmentId, kind: "week", periodFrom: startOfLocalDay(f.days[0].day, timezone), periodTo: startOfLocalDay(addDays(f.days[f.days.length - 1].day, 1), timezone), data: { advice: data } as unknown as Prisma.InputJsonValue, model, createdById: actor.userId } });
  await audit({ ...actor, action: "ai.week_advice", entityType: "ai_report", entityId: row.id, newValue: { model } });
  return { id: row.id, createdAt: row.createdAt, advice: data, model };
}

/* ------------------------------------------------------------------ Commande d'achats proposée */

const LEAD_DAYS = 2; // délai de livraison habituel
const SAFETY = 1.15; // marge de sécurité
const CONSUMPTION_DAYS = 28;
const n = (d: Prisma.Decimal | number) => Number(d);
const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * Pour chaque ingrédient : consommation moyenne des 4 dernières semaines, ajustée à l'activité prévue
 * sur les prochains jours (prévisions), plus le délai de livraison et une marge ; on commande ce qui manque
 * en colis entiers, chez le fournisseur le moins cher au kilo / à l'unité.
 */
export async function proposePurchase(establishmentId: string, timezone: string, horizon = 7) {
  const today = localDay(new Date(), timezone);
  const since = startOfLocalDay(addDays(today, -CONSUMPTION_DAYS), timezone);
  const [ingredients, sales, f] = await Promise.all([
    prisma.ingredient.findMany({ where: { establishmentId, isActive: true }, include: { supplierProducts: { include: { supplier: { select: { id: true, name: true, isActive: true } } } } } }),
    prisma.inventoryMovement.groupBy({ by: ["ingredientId"], where: { establishmentId, kind: "SALE", createdAt: { gte: since } }, _sum: { quantity: true } }),
    forecast(establishmentId, timezone, horizon + LEAD_DAYS),
  ]);
  // Activité prévue comparée à l'activité moyenne des 4 dernières semaines
  const history = await prisma.order.count({ where: { establishmentId, status: "PAID", closedAt: { gte: since } } });
  const expectedClients = f.days.reduce((a: number, d: ForecastDay) => a + d.expected.clients, 0);
  const coversHist = await prisma.order.aggregate({ where: { establishmentId, status: "PAID", closedAt: { gte: since } }, _sum: { covers: true } });
  const pastClientsPerDay = ((coversHist._sum.covers ?? 0) || history) / CONSUMPTION_DAYS;
  const activity = pastClientsPerDay > 0 ? Math.min(2, Math.max(0.5, expectedClients / (pastClientsPerDay * f.days.length))) : 1;
  const used = new Map(sales.map((s) => [s.ingredientId, Math.abs(n(s._sum.quantity ?? 0))]));

  type Line = { ingredientId: string; ingredient: string; unit: string; stockQty: number; dailyUse: number; daysLeft: number | null; need: number; supplierProductId: string; product: string; packSize: number; packs: number; unitPrice: number; reason: string };
  const bySupplier = new Map<string, { supplier: { id: string; name: string }; lines: Line[] }>();
  for (const ing of ingredients) {
    const dailyUse = round3(((used.get(ing.id) ?? 0) / CONSUMPTION_DAYS) * activity);
    const stock = n(ing.stockQty), min = n(ing.stockMin);
    const need = round3(dailyUse * (horizon + LEAD_DAYS) * SAFETY + min - stock);
    if (need <= 0 || (dailyUse === 0 && stock > min)) continue;
    const offers = ing.supplierProducts.filter((sp) => sp.supplier.isActive && n(sp.packSize) > 0);
    if (!offers.length) continue;
    const best = offers.sort((a, b) => (a.lastPrice || Infinity) / n(a.packSize) - (b.lastPrice || Infinity) / n(b.packSize))[0];
    const packs = Math.max(1, Math.ceil(need / n(best.packSize)));
    const daysLeft = dailyUse > 0 ? Math.floor(stock / dailyUse) : null;
    const g = bySupplier.get(best.supplierId) ?? { supplier: { id: best.supplier.id, name: best.supplier.name }, lines: [] };
    g.lines.push({
      ingredientId: ing.id, ingredient: ing.name, unit: ing.unit, stockQty: stock, dailyUse, daysLeft, need, supplierProductId: best.id, product: best.name, packSize: n(best.packSize), packs, unitPrice: best.lastPrice,
      reason: daysLeft !== null ? `${daysLeft <= 0 ? "Plus de stock" : `Environ ${daysLeft} jour${daysLeft > 1 ? "s" : ""} de stock`} au rythme prévu` : "Sous le seuil minimum",
    });
    bySupplier.set(best.supplierId, g);
  }
  const groups = [...bySupplier.values()].map((g) => ({ ...g, lines: g.lines.sort((a, b) => (a.daysLeft ?? 99) - (b.daysLeft ?? 99)), total: g.lines.reduce((a, l) => a + l.packs * l.unitPrice, 0) })).sort((a, b) => b.total - a.total);
  return { horizon, leadDays: LEAD_DAYS, activity: Math.round(activity * 100) / 100, groups };
}

/** Bons de commande en brouillon, un par fournisseur, à relire avant envoi */
export async function createProposedOrders(actor: Actor, timezone: string, supplierIds?: string[]) {
  const p = await proposePurchase(actor.establishmentId, timezone);
  const groups = p.groups.filter((g) => !supplierIds?.length || supplierIds.includes(g.supplier.id));
  if (!groups.length) throw new ApiError(409, "NOTHING_TO_ORDER", "Rien à commander pour l'instant");
  const created = [];
  for (const g of groups) {
    created.push(await createPurchaseOrder(actor, { supplierId: g.supplier.id, notes: `Proposé par l'Assistant IA (${p.horizon} jours d'activité prévue + ${p.leadDays} jours de livraison)`, lines: g.lines.map((l) => ({ supplierProductId: l.supplierProductId, quantity: l.packs, unitPrice: l.unitPrice })) }));
  }
  return created.map((po) => ({ id: po.id, number: po.number }));
}
