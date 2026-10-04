/**
 * Restaurant exemple, option Cave à vin : huit vins (domaines fictifs, appellations réelles) rangés par emplacement,
 * vendus à la bouteille, au verre ou en carafe dans une catégorie « Vins », avec leurs accords sur les plats de la carte,
 * trois bouteilles ouvertes (dont une à écouler) et la carte des vins affichée sur le site. Créé une seule fois.
 */
import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { servingProductName, type WineColor, type WineServing } from "../src/lib/wine";
import type { DemoCtx } from "./demo-activity";

type W = {
  producer: string; name: string; vintage: number | null; color: WineColor; appellation: string; region: string; country: string; grapes: string[]; abv: number;
  ml: number; location: string; bottles: number; min: number; cost: number; formats: [WineServing, number, number | null][];
  notes: string; pairing: string; dishes: string[]; temp: string; from?: number; until?: number; organic?: boolean;
  open?: { ml: number; hoursAgo: number }[];
};

const WINES: W[] = [
  { producer: "Domaine du Lagon", name: "Les Coraux", vintage: 2022, color: "WHITE", appellation: "Chablis", region: "Bourgogne", country: "France", grapes: ["Chardonnay"], abv: 12.5, ml: 750, location: "Cave · casier A", bottles: 16, min: 6, cost: 2400, formats: [["BOTTLE", 6900, null], ["GLASS", 1300, 120]], notes: "Nez d'agrumes et de fleurs blanches. Bouche tendue et minérale, finale saline : parfait avec le poisson cru.", pairing: "Poisson cru, sashimi, carpaccio de poisson", dishes: ["Poisson cru au lait de coco", "Sashimi de thon rouge", "Carpaccio de mahi-mahi", "Tartare de thon"], temp: "10-12 °C", from: 2023, until: 2027, open: [{ ml: 390, hoursAgo: 30 }] },
  { producer: "Maison Te Vai", name: "Sauvignon", vintage: 2023, color: "WHITE", appellation: "Marlborough", region: "Nouvelle-Zélande", country: "Nouvelle-Zélande", grapes: ["Sauvignon blanc"], abv: 13, ml: 750, location: "Cave · casier A", bottles: 11, min: 6, cost: 1900, formats: [["BOTTLE", 5500, null], ["GLASS", 1100, 120]], notes: "Fruit de la passion, citron vert et herbe coupée. Vif et désaltérant.", pairing: "Salades, poissons à la vanille, cuisine légère", dishes: ["Salade tahitienne", "Mahi-mahi sauce vanille", "Poisson grillé du jour"], temp: "8-10 °C" },
  { producer: "Château Mahana", name: "Rosé", vintage: 2023, color: "ROSE", appellation: "Côtes de Provence", region: "Provence", country: "France", grapes: ["Grenache", "Cinsault"], abv: 12.5, ml: 750, location: "Frigo du bar", bottles: 14, min: 6, cost: 1700, formats: [["BOTTLE", 4900, null], ["GLASS", 1000, 120], ["CARAFE", 3200, 500]], notes: "Robe pâle, notes de pêche blanche et de groseille. Frais et léger.", pairing: "Pizzas, volailles, beignets", dishes: ["Pizza Tahitienne", "Pizza Reine", "Poulet fafa", "Beignets de crevettes"], temp: "8-10 °C", open: [{ ml: 600, hoursAgo: 3 }] },
  { producer: "Domaine Hiva", name: "Vieilles vignes", vintage: 2020, color: "RED", appellation: "Côtes du Rhône", region: "Vallée du Rhône", country: "France", grapes: ["Grenache", "Syrah"], abv: 14, ml: 750, location: "Cave · casier B", bottles: 12, min: 6, cost: 1800, formats: [["BOTTLE", 5200, null], ["GLASS", 1000, 120], ["CARAFE", 3400, 500]], notes: "Fruits noirs, épices douces et garrigue. Tanins souples.", pairing: "Viandes grillées, burgers", dishes: ["Entrecôte 300 g", "Steak frites", "Burger Mana (double steak)", "Burger Bacon"], temp: "15-17 °C", from: 2022, until: 2028 },
  { producer: "Château Fare Ura", name: "Grand cru", vintage: 2016, color: "RED", appellation: "Saint-Émilion grand cru", region: "Bordeaux", country: "France", grapes: ["Merlot", "Cabernet franc"], abv: 14, ml: 750, location: "Cave · casier C", bottles: 5, min: 3, cost: 5200, formats: [["BOTTLE", 14500, null]], notes: "Cerise noire, cèdre et cacao. Ample, tanins fondus, belle longueur.", pairing: "Pièces de bœuf, plats mijotés", dishes: ["Entrecôte 300 g", "Chevrette curry coco"], temp: "16-18 °C", from: 2022, until: 2032 },
  { producer: "Domaine Te Ra'i", name: "Pinot noir", vintage: 2021, color: "RED", appellation: "Bourgogne", region: "Bourgogne", country: "France", grapes: ["Pinot noir"], abv: 13, ml: 750, location: "Cave · casier B", bottles: 4, min: 4, cost: 3100, formats: [["BOTTLE", 8900, null], ["GLASS", 1600, 120]], notes: "Framboise, sous-bois léger. Fin et digeste, se boit légèrement frais.", pairing: "Thon mi-cuit, volailles", dishes: ["Thon rouge mi-cuit"], temp: "14-15 °C", from: 2022, until: 2025, open: [{ ml: 300, hoursAgo: 24 * 4 + 2 }] },
  { producer: "Maison Mana", name: "Brut réserve", vintage: null, color: "SPARKLING", appellation: "Champagne", region: "Champagne", country: "France", grapes: ["Chardonnay", "Pinot noir", "Pinot meunier"], abv: 12, ml: 750, location: "Frigo du bar", bottles: 6, min: 4, cost: 4200, formats: [["BOTTLE", 11000, null], ["GLASS", 1900, 120]], notes: "Bulles fines, brioche et pomme mûre. Pour l'apéritif et les grandes occasions.", pairing: "Apéritif, fritures, desserts peu sucrés", dishes: ["Nems (4 pièces)", "Beignets de crevettes"], temp: "6-8 °C" },
  { producer: "Château Tiare", name: "Sauternes", vintage: 2018, color: "SWEET", appellation: "Sauternes", region: "Bordeaux", country: "France", grapes: ["Sémillon", "Sauvignon blanc"], abv: 13.5, ml: 375, location: "Cave · casier C", bottles: 6, min: 2, cost: 2600, formats: [["BOTTLE", 6800, null], ["GLASS", 1400, 80]], notes: "Abricot confit, miel et vanille. Liquoreux et frais à la fois.", pairing: "Desserts à la vanille, tartes", dishes: ["Crème brûlée vanille de Tahiti", "Tarte coco"], temp: "8-10 °C", from: 2022, until: 2040, organic: true },
];

export async function wineDemo(prisma: PrismaClient, ctx: DemoCtx) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { options: true } });
  if (!org.options.includes("wine")) await prisma.organization.update({ where: { id: ctx.orgId }, data: { options: [...org.options, "wine"] } });
  if (await prisma.wine.count({ where: { establishmentId: ctx.estId } })) return 0;

  // Catégorie « Vins » à la carte, envoyée au bar, au taux de TVA des vins déjà vendus
  const ref = await prisma.product.findFirst({ where: { establishmentId: ctx.estId, name: "Verre de vin rouge" }, select: { taxRateId: true, kitchenStationId: true } });
  const maxSort = await prisma.category.aggregate({ where: { establishmentId: ctx.estId }, _max: { sortOrder: true } });
  const cat = (await prisma.category.findFirst({ where: { establishmentId: ctx.estId, name: "Vins" } })) ?? await prisma.category.create({ data: { establishmentId: ctx.estId, name: "Vins", color: "#9f1239", sortOrder: (maxSort._max.sortOrder ?? 0) + 1 } });
  const dishes = await prisma.product.findMany({ where: { establishmentId: ctx.estId, isActive: true, name: { in: [...new Set(WINES.flatMap((w) => w.dishes))] } }, select: { id: true, name: true } });

  for (const [i, w] of WINES.entries()) {
    const bottleCl = w.ml / 10;
    const openMl = (w.open ?? []).reduce((a, b) => a + b.ml, 0);
    const label = `${w.producer} — ${w.name}${w.vintage ? ` ${w.vintage}` : ""}`;
    const ing = await prisma.ingredient.create({ data: { establishmentId: ctx.estId, name: label, unit: "cl", bottleMl: w.ml, isCritical: true, stockQty: w.bottles * bottleCl + openMl / 10, stockMin: w.min * bottleCl, avgCost: Math.round(w.cost / bottleCl), lastCost: Math.round(w.cost / bottleCl) } });
    const wine = await prisma.wine.create({
      data: {
        establishmentId: ctx.estId, ingredientId: ing.id, name: w.name, producer: w.producer, appellation: w.appellation, region: w.region, country: w.country, color: w.color,
        vintage: w.vintage, grapes: w.grapes, abv: w.abv, isOrganic: w.organic ?? false, tastingNotes: w.notes, pairingNotes: w.pairing, servingTemp: w.temp,
        drinkFrom: w.from ?? null, drinkUntil: w.until ?? null, location: w.location, sortOrder: i,
        pairedProductIds: dishes.filter((d) => w.dishes.includes(d.name)).map((d) => d.id),
      },
    });
    for (const [serving, price, servingMl] of w.formats) {
      const ml = serving === "BOTTLE" ? w.ml : servingMl!;
      await prisma.product.create({
        data: {
          establishmentId: ctx.estId, categoryId: cat.id, taxRateId: ref?.taxRateId ?? null, kitchenStationId: ref?.kitchenStationId ?? null,
          name: servingProductName(w, serving, ml), description: w.notes.slice(0, 300), priceTtc: price, costPrice: Math.round((w.cost * ml) / w.ml),
          wineId: wine.id, wineServing: serving, wineServingMl: ml, sortOrder: i * 3 + (serving === "BOTTLE" ? 0 : serving === "GLASS" ? 1 : 2),
          recipeLines: { create: [{ ingredientId: ing.id, quantity: ml / 10 }] },
        },
      });
    }
    for (const b of w.open ?? []) await prisma.wineOpenBottle.create({ data: { establishmentId: ctx.estId, wineId: wine.id, openedById: ctx.managerId, remainingMl: b.ml, openedAt: new Date(Date.now() - b.hoursAgo * 3600_000) } });
    // Réception d'origine, pour l'historique de la fiche
    await prisma.inventoryMovement.create({ data: { establishmentId: ctx.estId, ingredientId: ing.id, userId: ctx.managerId, kind: "PURCHASE", quantity: w.bottles * bottleCl + openMl / 10, unitCost: Math.round(w.cost / bottleCl), reason: "Réception cave à vin", createdAt: new Date(Date.now() - 12 * 86_400_000) } });
  }

  const est = await prisma.establishment.findUniqueOrThrow({ where: { id: ctx.estId }, select: { settings: true } });
  const settings = (est.settings ?? {}) as Record<string, unknown>;
  await prisma.establishment.update({ where: { id: ctx.estId }, data: { settings: { ...settings, wine: { showOnSite: true, listTitle: "Carte des vins", listIntro: "Une sélection de vignerons, à la bouteille, au verre ou en carafe.", hideOutOfStock: true } } as Prisma.InputJsonValue } });
  return WINES.length;
}
