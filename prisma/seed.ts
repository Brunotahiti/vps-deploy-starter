import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/server/auth/password";
import { ensureSystemRoles } from "../src/server/services/roles";
import { resetOfflineKeys } from "../src/server/services/offline-pass";
import { createEstablishmentDefaults } from "../src/server/services/establishments";
import { addDays, localDay } from "../src/lib/dates";
import { refreshDemo } from "./demo-activity";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const TZ = "Pacific/Tahiti";
/** À incrémenter quand le contenu de base de la démo change : elle est alors recréée au déploiement suivant. */
const DEMO_VERSION = 6;
// Illustrations locales des produits (public/demo/*.svg), remplaçables par de vraies photos depuis le back-office
import demoImages from "./demo-images.json" with { type: "json" };
import demoPhotos from "./demo-photos.json" with { type: "json" };
const IMAGES = demoImages as Record<string, string>;
const PHOTOS = demoPhotos as Record<string, string>; // vraies photos (Internet) ; illustrations locales en secours

type ProductSeed = { name: string; price: number; cost: number; desc?: string; station?: "CUISINE" | "BAR"; mods?: string[]; color?: string };

const CATALOG: { category: string; color: string; station: "CUISINE" | "BAR"; products: ProductSeed[] }[] = [
  { category: "Entrées", color: "#22C55E", station: "CUISINE", products: [
    { name: "Poisson cru au lait de coco", price: 1900, cost: 620, desc: "Thon rouge, citron vert, lait de coco, légumes croquants" },
    { name: "Tartare de thon", price: 2100, cost: 700 },
    { name: "Sashimi de thon rouge", price: 2300, cost: 820 },
    { name: "Salade tahitienne", price: 1600, cost: 450 },
    { name: "Carpaccio de mahi-mahi", price: 2000, cost: 650 },
    { name: "Beignets de crevettes", price: 1800, cost: 560 },
    { name: "Soupe chinoise", price: 1400, cost: 380 },
    { name: "Nems (4 pièces)", price: 1300, cost: 350 },
  ] },
  { category: "Plats", color: "#F97316", station: "CUISINE", products: [
    { name: "Burger Bacon", price: 2100, cost: 630, mods: ["Cuisson", "Accompagnement", "Suppléments burger"] },
    { name: "Cheeseburger", price: 1900, cost: 560, mods: ["Cuisson", "Accompagnement", "Suppléments burger"] },
    { name: "Burger Mana (double steak)", price: 2600, cost: 850, mods: ["Cuisson", "Accompagnement", "Suppléments burger"] },
    { name: "Thon rouge mi-cuit", price: 2900, cost: 1050, mods: ["Cuisson", "Accompagnement"] },
    { name: "Mahi-mahi sauce vanille", price: 3100, cost: 1100, mods: ["Accompagnement"] },
    { name: "Entrecôte 300 g", price: 3600, cost: 1400, mods: ["Cuisson", "Accompagnement"] },
    { name: "Poulet fafa", price: 2400, cost: 700 },
    { name: "Chevrette curry coco", price: 3200, cost: 1150 },
    { name: "Chow mein poulet", price: 1900, cost: 520 },
    { name: "Steak frites", price: 2500, cost: 850, mods: ["Cuisson"] },
    { name: "Pizza Margherita", price: 1700, cost: 420 },
    { name: "Pizza Reine", price: 1950, cost: 540 },
    { name: "Pizza Tahitienne", price: 2200, cost: 680 },
    { name: "Ma'a Tinito", price: 2100, cost: 620 },
    { name: "Poisson grillé du jour", price: 2800, cost: 950, mods: ["Accompagnement"] },
  ] },
  { category: "Desserts", color: "#EC4899", station: "CUISINE", products: [
    { name: "Po'e banane", price: 900, cost: 220 },
    { name: "Tarte coco", price: 1000, cost: 260 },
    { name: "Crème brûlée vanille de Tahiti", price: 1100, cost: 300 },
    { name: "Fondant chocolat", price: 1100, cost: 320 },
    { name: "Salade de fruits frais", price: 900, cost: 280 },
    { name: "Firi firi (3 pièces)", price: 700, cost: 150 },
    { name: "Glace 2 boules", price: 800, cost: 200 },
    { name: "Café gourmand", price: 1200, cost: 350 },
  ] },
  { category: "Boissons", color: "#3B82F6", station: "BAR", products: [
    { name: "Eau minérale 50 cl", price: 350, cost: 90 }, { name: "Eau gazeuse 50 cl", price: 400, cost: 110 },
    { name: "Coca-Cola 33 cl", price: 450, cost: 140 }, { name: "Limonade 33 cl", price: 450, cost: 130 },
    { name: "Jus d'ananas", price: 600, cost: 180 }, { name: "Jus de pamplemousse", price: 600, cost: 180 },
    { name: "Café expresso", price: 300, cost: 60 }, { name: "Café allongé", price: 350, cost: 70 },
    { name: "Thé", price: 350, cost: 60 }, { name: "Chocolat chaud", price: 500, cost: 120 },
    { name: "Hinano 33 cl", price: 600, cost: 210 }, { name: "Hinano pression 50 cl", price: 900, cost: 280 },
    { name: "Tabu blonde 33 cl", price: 650, cost: 230 }, { name: "Verre de vin rouge", price: 800, cost: 260 },
    { name: "Verre de vin blanc", price: 800, cost: 260 }, { name: "Verre de rosé", price: 800, cost: 260 },
    { name: "Cocktail Mai Tai", price: 1400, cost: 400 }, { name: "Cocktail Piña Colada", price: 1400, cost: 420 },
    { name: "Mojito", price: 1300, cost: 380 }, { name: "Cocktail sans alcool", price: 900, cost: 250 },
  ] },
];

const MODIFIER_GROUPS: { name: string; minSelect: number; maxSelect: number | null; modifiers: { name: string; price: number; def?: boolean }[] }[] = [
  { name: "Cuisson", minSelect: 1, maxSelect: 1, modifiers: [{ name: "Bleu", price: 0 }, { name: "Saignant", price: 0 }, { name: "À point", price: 0, def: true }, { name: "Bien cuit", price: 0 }] },
  { name: "Accompagnement", minSelect: 1, maxSelect: 1, modifiers: [{ name: "Frites", price: 0, def: true }, { name: "Salade", price: 0 }, { name: "Légumes", price: 0 }, { name: "Riz", price: 0 }] },
  { name: "Suppléments burger", minSelect: 0, maxSelect: null, modifiers: [{ name: "Bacon", price: 250 }, { name: "Fromage", price: 150 }, { name: "Avocat", price: 300 }, { name: "Œuf", price: 150 }] },
];

async function main() {
  const existing = await prisma.organization.findUnique({ where: { slug: "demo-mana-beach" } });
  if (existing) {
    // Une démo d'une version plus ancienne est recréée une fois (nouveau contenu de base) ; sinon elle est seulement rafraîchie
    const mark = await prisma.auditLog.findFirst({ where: { organizationId: existing.id, action: "demo.seed" }, orderBy: { createdAt: "desc" }, select: { newValue: true } });
    const version = (mark?.newValue as { version?: number } | null)?.version ?? 1;
    if (process.env.RESEED !== "1" && version >= DEMO_VERSION) {
      // Démo déjà présente : on la fait vivre (journées manquantes, service du jour) ; RESEED=1 pour la recréer
      console.log("→ Rafraîchissement de la démo…");
      const r = await refreshDemo(prisma, { log: console.log });
      console.log(r ? `✓ Démo à jour (${r.today})` : "Démo non rafraîchie");
      return;
    }
    console.log(version < DEMO_VERSION ? `→ Démo version ${version} → ${DEMO_VERSION} : recréation…` : "→ Suppression de l'ancienne démo…");
    await prisma.organization.delete({ where: { id: existing.id } });
  }
  console.log("→ Création de l'entreprise de démonstration…");
  // Restaurant exemple : toutes les options ouvertes, pour tout montrer
  const org = await prisma.organization.create({ data: { name: "Mana Beach SARL", slug: "demo-mana-beach", plan: "TRIAL", trialEndsAt: new Date(Date.now() + 12 * 86_400_000), options: ["stock", "digital", "team", "advanced"] } });
  await ensureSystemRoles(org.id);
  const roles = Object.fromEntries((await prisma.role.findMany({ where: { organizationId: org.id } })).map((r) => [r.key, r.id]));

  const est = await prisma.establishment.create({
    data: {
      organizationId: org.id, name: "Le Mana Beach", slug: "le-mana-beach", legalName: "Mana Beach SARL", tahitiNumber: "A12345", addressLine1: "PK 18,2 côté mer",
      city: "Punaauia", island: "Tahiti", postalCode: "98718", phone: "+689 40 12 34 56", email: "contact@manabeach.pf", tipsEnabled: true, onboardingDone: true, onboardingStep: 15,
      openingHours: { mon: ["11:00-14:30", "18:00-22:00"], tue: ["11:00-14:30", "18:00-22:00"], wed: ["11:00-14:30", "18:00-22:00"], thu: ["11:00-14:30", "18:00-22:00"], fri: ["11:00-14:30", "18:00-23:00"], sat: ["11:00-15:00", "18:00-23:00"], sun: ["11:00-15:00"] },
    },
  });
  await createEstablishmentDefaults(est.id);
  const taxRates = await prisma.taxRate.findMany({ where: { establishmentId: est.id } });
  const taxResto = taxRates.find((t) => t.isDefault)!;
  const taxNormal = taxRates.find((t) => t.rateBps === 1600)!;
  const stations = Object.fromEntries((await prisma.kitchenStation.findMany({ where: { establishmentId: est.id } })).map((s) => [s.name, s.id]));

  console.log("→ Personnel…");
  const pw = await hashPassword("demo1234");
  const mkUser = async (email: string, first: string, last: string, roleKey: string | null, pin: string, color: string, isOwner = false) => {
    const u = await prisma.user.create({ data: { organizationId: org.id, email, passwordHash: pw, pinHash: await hashPassword(pin), firstName: first, lastName: last, color, isOwner, displayName: first } });
    if (roleKey) await prisma.userEstablishment.create({ data: { userId: u.id, establishmentId: est.id, roleId: roles[roleKey] } });
    await resetOfflineKeys(u.id, pin); // connexion par PIN possible sans internet dès le premier jour
    return u;
  };
  const owner = await mkUser("demo@manaresto.pf", "Teiva", "Manutahi", null, "1234", "#0EA5A4", true);
  const manager = await mkUser("manager@manaresto.pf", "Hinatea", "Tehei", "manager", "2000", "#8B5CF6");
  const servers: { id: string }[] = [];
  const serverNames: [string, string, string][] = [["Moana", "Tefaatau", "1001"], ["Vaiana", "Raapoto", "1002"], ["Tamatoa", "Bonno", "1003"], ["Poema", "Chang", "1004"], ["Heimana", "Wong", "1005"]];
  const colors = ["#F97316", "#22C55E", "#3B82F6", "#EC4899", "#EAB308"];
  for (const [i, [f, l, pin]] of serverNames.entries()) servers.push(await mkUser(`${f.toLowerCase()}@manaresto.pf`, f, l, "server", pin, colors[i]));
  await mkUser("cuisine@manaresto.pf", "Rai", "Cuisine", "kitchen", "3000", "#EF4444");
  await mkUser("bar@manaresto.pf", "Manu", "Bar", "bartender", "4000", "#06B6D4");
  await mkUser("compta@manaresto.pf", "Léa", "Comptable", "accountant", "5000", "#64748B");

  console.log("→ Personnel : fiches, planning, pointages…");
  const staffRows: { userId: string; first: string; last: string; job: string; cost: number }[] = [
    { userId: manager.id, first: "Hinatea", last: "Tehei", job: "Manager", cost: 2600 },
    ...serverNames.map(([f, l], i) => ({ userId: servers[i].id, first: f, last: l, job: "Serveur", cost: 1650 + i * 50 })),
  ];
  const cuisineUser = await prisma.user.findUniqueOrThrow({ where: { email: "cuisine@manaresto.pf" } });
  const barUser = await prisma.user.findUniqueOrThrow({ where: { email: "bar@manaresto.pf" } });
  staffRows.push({ userId: cuisineUser.id, first: "Rai", last: "Cuisine", job: "Chef de cuisine", cost: 2400 }, { userId: barUser.id, first: "Manu", last: "Bar", job: "Barman", cost: 1800 });
  const employees: { id: string; job: string }[] = [];
  for (const r of staffRows) employees.push({ id: (await prisma.employee.create({ data: { establishmentId: est.id, userId: r.userId, firstName: r.first, lastName: r.last, jobTitle: r.job, hourlyCost: r.cost } })).id, job: r.job });
  employees.push({ id: (await prisma.employee.create({ data: { establishmentId: est.id, firstName: "Tehani", lastName: "Extra", jobTitle: "Plonge (extra)", hourlyCost: 1400, pinHash: await hashPassword("7777") } })).id, job: "Plonge" });
  console.log("→ Clients, fidélité, réglages digitaux…");
  await prisma.establishment.update({ where: { id: est.id }, data: { settings: { courses: ["APÉRITIFS", "ENTRÉES", "PLATS", "DESSERTS"], digital: { qrMode: "ORDER", online: { enabled: true, pickup: true, delivery: true, pickupLeadMin: 20, deliveryFee: 500, deliveryMinOrder: 3000, deliveryZones: ["Punaauia", "Paea", "Faa'a"], message: "Commandes en ligne de 11 h à 13 h 30 et de 18 h à 21 h. Paiement sur place." }, kiosk: { enabled: true, dineIn: true, takeaway: true } }, loyalty: { enabled: true, pointsPer100: 1, rewardPoints: 100, rewardValue: 1000 }, site: { enabled: true, tagline: "Cuisine du lagon, les pieds dans le sable", description: "Depuis 2012, Le Mana Beach vous accueille face au lagon de Punaauia : poisson cru au lait de coco, thon rouge de la criée, grillades au feu de bois et desserts aux fruits du fenua.\nTerrasse sur la plage, parking gratuit, cocktails au coucher du soleil.", showMenu: true, showPrices: true, accent: "#14aaa3", coverUrl: "/demo/site/couverture.webp", photos: ["/demo/site/terrasse.webp", "/demo/site/partage.webp", "/demo/site/plage.webp", "/demo/site/bar.webp", "/demo/site/tablee.webp", "/demo/site/lagon.webp"] } } } });
  const CUSTOMERS: [string, string, string, string | null, string | null, number, number, number][] = [
    ["Teiki", "Faatau", "+689 87 11 22 33", "teiki@mail.pf", null, 14, 186500, 165], ["Hina", "Tetuanui", "+689 87 44 55 66", "hina.t@mail.pf", "Fruits de mer", 9, 98200, 82], ["Marc", "Dupont", "+689 89 12 34 56", null, null, 4, 41300, 41],
    ["Vaimiti", "Pambrun", "+689 87 99 88 77", "vaimiti@mail.pf", "Gluten", 21, 312400, 12], ["Sophie", "Martin", "+689 87 65 43 21", "sophie.m@mail.pf", null, 2, 12800, 128], ["Tama", "Ariipeu", "+689 89 00 11 22", null, null, 6, 54700, 47],
  ];
  // Clientèle plus large : habitués reconnus à la caisse (fidélité alimentée par l'activité générée)
  const FIRST = ["Teva", "Moana", "Heiata", "Rahiti", "Tuarii", "Hinanui", "Mareva", "Kevin", "Julie", "Thomas", "Camille", "Lucas", "Manon", "Hugo", "Léa", "Rauarii", "Tamatea", "Vaitea", "Matahi", "Anaïs", "Nicolas", "Sarah", "Raimana", "Tehina", "Maeva", "Alexandre", "Emma", "Ariitai", "Poerava", "Yann"];
  const LAST = ["Teriitahi", "Tauotaha", "Lucas", "Bambridge", "Salmon", "Brotherson", "Lehartel", "Chin", "Bernard", "Petit", "Richard", "Durand", "Tetuanui", "Temauri", "Flosse", "Pito", "Wong", "Laurent", "Moux", "Tchen"];
  for (let i = 0; i < FIRST.length; i++) {
    const f = FIRST[i], l = LAST[(i * 7) % LAST.length];
    CUSTOMERS.push([f, l, `+689 87 ${String(20 + i).padStart(2, "0")} ${String(10 + ((i * 37) % 89)).padStart(2, "0")} ${String(10 + ((i * 53) % 89)).padStart(2, "0")}`, i % 3 === 0 ? `${f.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}.${l.toLowerCase()}@mail.pf` : null, i % 9 === 4 ? "Arachides" : null, 0, 0, 0]);
  }
  const customerIds: string[] = [];
  for (const [f, l, phone, email, allergies, visits, spent, points] of CUSTOMERS) {
    const c = await prisma.customer.create({ data: { organizationId: org.id, firstName: f, lastName: l, phone, email, allergies, visitCount: visits, totalSpent: spent } });
    customerIds.push(c.id);
    if (!visits) continue;
    const acc = await prisma.loyaltyAccount.create({ data: { establishmentId: est.id, customerId: c.id, points } });
    await prisma.loyaltyTransaction.create({ data: { accountId: acc.id, points: points + (visits > 10 ? 100 : 0), reason: "Historique des visites" } });
    if (visits > 10) await prisma.loyaltyTransaction.create({ data: { accountId: acc.id, points: -100, reason: "Récompense utilisée" } });
  }
  console.log("→ Salles et tables…");
  const salle = await prisma.room.create({ data: { establishmentId: est.id, name: "Salle", kind: "INDOOR", sortOrder: 0, width: 1200, height: 800 } });
  const terrasse = await prisma.room.create({ data: { establishmentId: est.id, name: "Terrasse", kind: "TERRACE", sortOrder: 1, width: 1200, height: 700 } });
  const tables: { id: string }[] = [];
  for (let i = 1; i <= 12; i++) {
    const col = (i - 1) % 4, row = Math.floor((i - 1) / 4);
    tables.push(await prisma.table.create({ data: { establishmentId: est.id, roomId: salle.id, name: `T${String(i).padStart(2, "0")}`, seats: i % 3 === 0 ? 6 : i % 2 === 0 ? 4 : 2, shape: i % 3 === 0 ? "RECT" : i % 2 === 0 ? "SQUARE" : "ROUND", x: 80 + col * 260, y: 80 + row * 230, width: i % 3 === 0 ? 180 : 110, height: 110 } }));
  }
  for (let i = 13; i <= 20; i++) {
    const col = (i - 13) % 4, row = Math.floor((i - 13) / 4);
    tables.push(await prisma.table.create({ data: { establishmentId: est.id, roomId: terrasse.id, name: `T${i}`, seats: i % 2 === 0 ? 4 : 2, shape: i % 2 === 0 ? "SQUARE" : "ROUND", x: 80 + col * 260, y: 100 + row * 260, width: 110, height: 110 } }));
  }

  console.log("→ Catalogue…");
  const groups: Record<string, string> = {};
  for (const [gi, g] of MODIFIER_GROUPS.entries()) {
    const created = await prisma.modifierGroup.create({ data: { establishmentId: est.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, sortOrder: gi, modifiers: { create: g.modifiers.map((m, i) => ({ name: m.name, priceDelta: m.price, isDefault: !!m.def, sortOrder: i })) } } });
    groups[g.name] = created.id;
  }
  const productsByCategory: Record<string, { id: string; name: string; priceTtc: number; costPrice: number; taxRateBps: number; taxRateName: string; stationId: string | null; groups: string[] }[]> = {};
  for (const [ci, cat] of CATALOG.entries()) {
    const category = await prisma.category.create({ data: { establishmentId: est.id, name: cat.category, color: cat.color, sortOrder: ci } });
    productsByCategory[cat.category] = [];
    for (const [pi, p] of cat.products.entries()) {
      const tax = cat.station === "BAR" && /Hinano|Tabu|vin|Cocktail|Mojito/.test(p.name) ? taxNormal : taxResto;
      const prod = await prisma.product.create({
        data: {
          establishmentId: est.id, categoryId: category.id, taxRateId: tax.id, kitchenStationId: stations[cat.station], name: p.name, description: p.desc ?? null, imageUrl: PHOTOS[p.name] ?? IMAGES[p.name] ?? null, priceTtc: p.price, costPrice: p.cost,
          sku: `${cat.category.slice(0, 3).toUpperCase()}-${String(pi + 1).padStart(3, "0")}`, sortOrder: pi, color: p.color ?? null,
          modifierGroups: p.mods ? { create: p.mods.map((m, i) => ({ modifierGroupId: groups[m], sortOrder: i })) } : undefined,
        },
      });
      productsByCategory[cat.category].push({ id: prod.id, name: prod.name, priceTtc: prod.priceTtc, costPrice: prod.costPrice, taxRateBps: tax.rateBps, taxRateName: tax.name, stationId: stations[cat.station], groups: p.mods ?? [] });
    }
  }
  const entrees = productsByCategory["Entrées"], plats = productsByCategory["Plats"], desserts = productsByCategory["Desserts"];
  await prisma.menu.create({
    data: {
      establishmentId: est.id, name: "Menu déjeuner", description: "Entrée + plat + dessert", priceTtc: 3500, taxRateId: taxResto.id, color: "#0EA5A4",
      sections: { create: [
        { name: "Entrée", minSelect: 1, maxSelect: 1, sortOrder: 0, items: { create: [entrees[0], entrees[3], entrees[6]].map((p, i) => ({ productId: p.id, supplement: 0, sortOrder: i })) } },
        { name: "Plat", minSelect: 1, maxSelect: 1, sortOrder: 1, items: { create: [{ productId: plats[6].id, supplement: 0, sortOrder: 0 }, { productId: plats[8].id, supplement: 0, sortOrder: 1 }, { productId: plats[9].id, supplement: 0, sortOrder: 2 }, { productId: plats[5].id, supplement: 500, sortOrder: 3 }] } },
        { name: "Dessert", minSelect: 1, maxSelect: 1, sortOrder: 2, items: { create: [{ productId: desserts[0].id, supplement: 0, sortOrder: 0 }, { productId: desserts[1].id, supplement: 0, sortOrder: 1 }, { productId: desserts[2].id, supplement: 300, sortOrder: 2 }] } },
      ] },
    },
  });

  console.log("→ Stock : ingrédients, recettes, fournisseurs, achats…");
  const ING: [string, string, number, number, number, boolean][] = [
    // nom, unité, stock, seuil, coût moyen par unité, critique
    ["Thon rouge", "g", 6200, 3000, 2.4, true], ["Mahi-mahi", "g", 3100, 2000, 1.9, true], ["Steak haché 150 g", "pce", 38, 20, 320, true], ["Pain burger", "pce", 44, 24, 90, true],
    ["Bacon", "g", 1400, 800, 2.1, false], ["Cheddar", "g", 1800, 600, 1.4, false], ["Frites surgelées", "kg", 14, 8, 420, false], ["Lait de coco", "ml", 5200, 2000, 0.5, false],
    ["Citron vert", "pce", 60, 30, 55, false], ["Crevettes", "g", 2600, 1500, 3.2, false], ["Mozzarella", "g", 2400, 1000, 1.6, false], ["Pâte à pizza", "pce", 26, 12, 140, true],
    ["Hinano 33 cl", "pce", 96, 48, 210, true], ["Coca-Cola 33 cl", "pce", 120, 48, 150, true], ["Eau minérale 50 cl", "pce", 84, 36, 95, true], ["Chocolat noir", "g", 1500, 500, 2.8, false], ["Œufs", "pce", 90, 30, 45, false],
  ];
  const ings: Record<string, { id: string; unit: string }> = {};
  for (const [name, unit, stock, min, cost, critical] of ING) {
    const row = await prisma.ingredient.create({ data: { establishmentId: est.id, name, unit, stockQty: stock, stockMin: min, avgCost: Math.round(cost), lastCost: Math.round(cost), isCritical: critical } });
    ings[name] = { id: row.id, unit };
  }
  const allProducts = Object.values(productsByCategory).flat();
  const byName = (n: string) => allProducts.find((p) => p.name === n);
  const RECIPES: [string, [string, number][]][] = [
    ["Poisson cru au lait de coco", [["Thon rouge", 160], ["Lait de coco", 80], ["Citron vert", 1]]], ["Tartare de thon", [["Thon rouge", 150], ["Citron vert", 1]]], ["Sashimi de thon rouge", [["Thon rouge", 180]]],
    ["Carpaccio de mahi-mahi", [["Mahi-mahi", 140], ["Citron vert", 1]]], ["Beignets de crevettes", [["Crevettes", 120], ["Œufs", 1]]],
    ["Burger Bacon", [["Steak haché 150 g", 1], ["Pain burger", 1], ["Bacon", 40], ["Cheddar", 30], ["Frites surgelées", 0.18]]], ["Cheeseburger", [["Steak haché 150 g", 1], ["Pain burger", 1], ["Cheddar", 40], ["Frites surgelées", 0.18]]],
    ["Burger Mana (double steak)", [["Steak haché 150 g", 2], ["Pain burger", 1], ["Cheddar", 40], ["Frites surgelées", 0.18]]], ["Thon rouge mi-cuit", [["Thon rouge", 200], ["Frites surgelées", 0.15]]],
    ["Pizza Reine", [["Pâte à pizza", 1], ["Mozzarella", 120]]], ["Fondant chocolat", [["Chocolat noir", 60], ["Œufs", 2]]],
    ["Hinano 33 cl", [["Hinano 33 cl", 1]]], ["Coca-Cola 33 cl", [["Coca-Cola 33 cl", 1]]], ["Eau minérale 50 cl", [["Eau minérale 50 cl", 1]]],
  ];
  for (const [product, lines] of RECIPES) {
    const prod = byName(product);
    if (!prod) continue;
    await prisma.recipeLine.createMany({ data: lines.filter(([ing]) => ings[ing]).map(([ing, qty]) => ({ productId: prod.id, ingredientId: ings[ing].id, quantity: qty })) });
  }
  const marchePapeete = await prisma.supplier.create({ data: { establishmentId: est.id, name: "Marché de Papeete — Poissonnerie Teva", contactName: "Teva", phone: "+689 87 12 34 56", email: "teva.poissons@mail.pf" } });
  const brasserie = await prisma.supplier.create({ data: { establishmentId: est.id, name: "Brasserie de Tahiti", contactName: "Service pro", phone: "+689 40 55 66 77", email: "pro@brasseriedetahiti.pf" } });
  const wingChong = await prisma.supplier.create({ data: { establishmentId: est.id, name: "Wing Chong — Gros alimentaire", phone: "+689 40 42 12 12" } });
  const SP: [typeof marchePapeete, string, string, number, number][] = [
    [marchePapeete, "Thon rouge longe (kg)", "Thon rouge", 1000, 2400], [marchePapeete, "Mahi-mahi filet (kg)", "Mahi-mahi", 1000, 1900], [marchePapeete, "Crevettes (kg)", "Crevettes", 1000, 3200],
    [brasserie, "Carton Hinano 33 cl × 24", "Hinano 33 cl", 24, 5040], [brasserie, "Carton Coca-Cola 33 cl × 24", "Coca-Cola 33 cl", 24, 3600], [brasserie, "Pack eau 50 cl × 12", "Eau minérale 50 cl", 12, 1140],
    [wingChong, "Steaks hachés 150 g × 20", "Steak haché 150 g", 20, 6400], [wingChong, "Pains burger × 12", "Pain burger", 12, 1080], [wingChong, "Frites surgelées 2,5 kg", "Frites surgelées", 2.5, 1050], [wingChong, "Cheddar tranches 1 kg", "Cheddar", 1000, 1400], [wingChong, "Bacon 500 g", "Bacon", 500, 1050],
  ];
  const sps: Record<string, string> = {};
  for (const [sup, name, ing, pack, price] of SP) {
    const row = await prisma.supplierProduct.create({ data: { supplierId: sup.id, ingredientId: ings[ing].id, name, packSize: pack, lastPrice: price, avgPrice: price } });
    sps[name] = row.id;
  }
  const stockToday = localDay(new Date(), TZ);
  const poDay = addDays(stockToday, -3).replace(/-/g, "");
  await prisma.purchaseOrder.create({ data: { establishmentId: est.id, supplierId: brasserie.id, number: `BC-${poDay}-001`, status: "RECEIVED", total: 5040 * 4 + 3600 * 3, createdAt: new Date(Date.now() - 3 * 86400000), receivedAt: new Date(Date.now() - 2 * 86400000), lines: { create: [{ supplierProductId: sps["Carton Hinano 33 cl × 24"], quantity: 4, receivedQty: 4, unitPrice: 5040 }, { supplierProductId: sps["Carton Coca-Cola 33 cl × 24"], quantity: 3, receivedQty: 3, unitPrice: 3600 }] } } });
  await prisma.purchaseOrder.create({ data: { establishmentId: est.id, supplierId: marchePapeete.id, number: `BC-${stockToday.replace(/-/g, "")}-001`, status: "SENT", total: 2400 * 5 + 1900 * 3, expectedAt: new Date(Date.now() + 86400000), lines: { create: [{ supplierProductId: sps["Thon rouge longe (kg)"], quantity: 5, unitPrice: 2400 }, { supplierProductId: sps["Mahi-mahi filet (kg)"], quantity: 3, unitPrice: 1900 }] } } });
  // Exemples de mouvements manuels (les ventes viennent des commandes générées, jour par jour)
  const daysAgo = (d: number) => new Date(Date.now() - d * 86400000 - 3 * 3600000);
  await prisma.inventoryMovement.create({ data: { establishmentId: est.id, ingredientId: ings["Hinano 33 cl"].id, userId: manager.id, kind: "PURCHASE", quantity: 96, unitCost: 210, reason: `Réception BC-${poDay}-001`, createdAt: daysAgo(2) } });
  await prisma.inventoryMovement.create({ data: { establishmentId: est.id, ingredientId: ings["Coca-Cola 33 cl"].id, userId: manager.id, kind: "PURCHASE", quantity: 72, unitCost: 150, reason: `Réception BC-${poDay}-001`, createdAt: daysAgo(2) } });
  await prisma.inventoryMovement.create({ data: { establishmentId: est.id, ingredientId: ings["Thon rouge"].id, userId: manager.id, kind: "LOSS", quantity: -400, unitCost: 2, reason: "Périmé (DLC dépassée)", createdAt: daysAgo(4) } });
  await prisma.inventoryMovement.create({ data: { establishmentId: est.id, ingredientId: ings["Pain burger"].id, userId: manager.id, kind: "BREAKAGE", quantity: -6, unitCost: 90, reason: "Pains écrasés à la livraison", createdAt: daysAgo(1) } });
  // Un ingrédient critique en rupture pour illustrer l'indisponibilité automatique
  await prisma.ingredient.update({ where: { id: ings["Pâte à pizza"].id }, data: { stockQty: 0 } });
  await prisma.product.updateMany({ where: { id: byName("Pizza Reine")?.id ?? "" }, data: { autoUnavailable: true } });

  console.log("→ Activité : 60 jours d'historique et service du jour…");
  await refreshDemo(prisma, { log: console.log });
  const counter = await prisma.order.count({ where: { establishmentId: est.id } });

  await prisma.auditLog.create({ data: { organizationId: org.id, establishmentId: est.id, userId: owner.id, action: "demo.seed", entityType: "establishment", entityId: est.id, newValue: { orders: counter, version: DEMO_VERSION } } });
  console.log(`✓ Démo créée : ${counter} commandes. Connexion : demo@manaresto.pf / demo1234 (PIN 1234)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
