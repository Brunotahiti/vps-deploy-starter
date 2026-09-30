import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/server/auth/password";
import { ensureSystemRoles } from "../src/server/services/roles";
import { createEstablishmentDefaults } from "../src/server/services/establishments";
import { computeLine, computeOrderTotals } from "../src/lib/order-calc";
import crypto from "node:crypto";
import { addDays, endOfLocalDay, localDay, startOfLocalDay } from "../src/lib/dates";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });

const TZ = "Pacific/Tahiti";
// Illustrations locales des produits (public/demo/*.svg), remplaçables par de vraies photos depuis le back-office
import demoImages from "./demo-images.json" with { type: "json" };
const IMAGES = demoImages as Record<string, string>;

// Générateur pseudo-aléatoire déterministe (données de démo reproductibles)
let seedState = 20260929;
const rand = () => { seedState = (seedState * 1103515245 + 12345) & 0x7fffffff; return seedState / 0x7fffffff; };
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));

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
    if (process.env.RESEED !== "1") {
      console.log("Démo déjà présente (organisation demo-mana-beach). Relancez avec RESEED=1 pour la régénérer.");
      return;
    }
    console.log("→ Suppression de l'ancienne démo…");
    await prisma.organization.delete({ where: { id: existing.id } });
  }
  console.log("→ Création de l'entreprise de démonstration…");
  const org = await prisma.organization.create({ data: { name: "Mana Beach SARL", slug: "demo-mana-beach" } });
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
  const seedToday = localDay(new Date(), TZ);
  const atLocal = (day: string, h: number, m = 0) => new Date(startOfLocalDay(day, TZ).getTime() + (h * 60 + m) * 60000);
  for (let d = 7; d >= 0; d--) {
    const day = addDays(seedToday, -d);
    const dow = new Date(day + "T12:00:00Z").getUTCDay();
    for (const [i, e] of employees.entries()) {
      if (dow === 0 && i % 2 === 0) continue; // repos
      const lunch = i % 3 !== 2, dinner = i % 3 !== 1;
      if (lunch) await prisma.shift.create({ data: { establishmentId: est.id, employeeId: e.id, startsAt: atLocal(day, 10, 30), endsAt: atLocal(day, 15), notes: "Midi" } });
      if (dinner) await prisma.shift.create({ data: { establishmentId: est.id, employeeId: e.id, startsAt: atLocal(day, 17, 30), endsAt: atLocal(day, 22, 30), notes: "Soir" } });
      if (d === 0) continue; // aujourd'hui : pointages réalisés plus bas
      const jitter = () => between(-8, 12);
      if (lunch) { await prisma.timeEntry.create({ data: { establishmentId: est.id, employeeId: e.id, kind: "CLOCK_IN", at: atLocal(day, 10, 30 + jitter()) } }); await prisma.timeEntry.create({ data: { establishmentId: est.id, employeeId: e.id, kind: "BREAK_START", at: atLocal(day, 13, 0 + jitter()) } }); await prisma.timeEntry.create({ data: { establishmentId: est.id, employeeId: e.id, kind: "BREAK_END", at: atLocal(day, 13, 25 + jitter()) } }); await prisma.timeEntry.create({ data: { establishmentId: est.id, employeeId: e.id, kind: "CLOCK_OUT", at: atLocal(day, 15, 5 + jitter()) } }); }
      if (dinner) { await prisma.timeEntry.create({ data: { establishmentId: est.id, employeeId: e.id, kind: "CLOCK_IN", at: atLocal(day, 17, 30 + jitter()) } }); await prisma.timeEntry.create({ data: { establishmentId: est.id, employeeId: e.id, kind: "CLOCK_OUT", at: atLocal(day, 22, 35 + jitter()) } }); }
    }
  }
  // Aujourd'hui : quelques employés déjà pointés (en service ou en pause)
  const nowMs = Date.now();
  for (const [i, e] of employees.slice(0, 5).entries()) {
    await prisma.timeEntry.create({ data: { establishmentId: est.id, employeeId: e.id, kind: "CLOCK_IN", at: new Date(nowMs - (150 + i * 12) * 60000) } });
    if (i === 2) await prisma.timeEntry.create({ data: { establishmentId: est.id, employeeId: e.id, kind: "BREAK_START", at: new Date(nowMs - 10 * 60000) } });
  }

  console.log("→ Clients, fidélité, réglages digitaux…");
  await prisma.establishment.update({ where: { id: est.id }, data: { settings: { courses: ["APÉRITIFS", "ENTRÉES", "PLATS", "DESSERTS"], digital: { qrMode: "ORDER", online: { enabled: true, pickup: true, delivery: true, pickupLeadMin: 20, deliveryFee: 500, deliveryMinOrder: 3000, deliveryZones: ["Punaauia", "Paea", "Faa'a"], message: "Commandes en ligne de 11 h à 13 h 30 et de 18 h à 21 h. Paiement sur place." }, kiosk: { enabled: true, dineIn: true, takeaway: true } }, loyalty: { enabled: true, pointsPer100: 1, rewardPoints: 100, rewardValue: 1000 } } } });
  const CUSTOMERS: [string, string, string, string | null, string | null, number, number, number][] = [
    ["Teiki", "Faatau", "+689 87 11 22 33", "teiki@mail.pf", null, 14, 186500, 165], ["Hina", "Tetuanui", "+689 87 44 55 66", "hina.t@mail.pf", "Fruits de mer", 9, 98200, 82], ["Marc", "Dupont", "+689 89 12 34 56", null, null, 4, 41300, 41],
    ["Vaimiti", "Pambrun", "+689 87 99 88 77", "vaimiti@mail.pf", "Gluten", 21, 312400, 12], ["Sophie", "Martin", "+689 87 65 43 21", "sophie.m@mail.pf", null, 2, 12800, 128], ["Tama", "Ariipeu", "+689 89 00 11 22", null, null, 6, 54700, 47],
  ];
  const customerIds: string[] = [];
  for (const [f, l, phone, email, allergies, visits, spent, points] of CUSTOMERS) {
    const c = await prisma.customer.create({ data: { organizationId: org.id, firstName: f, lastName: l, phone, email, allergies, visitCount: visits, totalSpent: spent } });
    customerIds.push(c.id);
    const acc = await prisma.loyaltyAccount.create({ data: { establishmentId: est.id, customerId: c.id, points } });
    await prisma.loyaltyTransaction.create({ data: { accountId: acc.id, points: points + (visits > 10 ? 100 : 0), reason: "Historique des visites" } });
    if (visits > 10) await prisma.loyaltyTransaction.create({ data: { accountId: acc.id, points: -100, reason: "Récompense utilisée" } });
  }
  console.log("→ Réservations…");
  const resDay = localDay(new Date(), TZ);
  const resAt = (day: string, h: number, m = 0) => new Date(startOfLocalDay(day, TZ).getTime() + (h * 60 + m) * 60000);
  const RES: [string, number, string, number, number, string, string | null][] = [
    ["Teiki Faatau", 0, resDay, 12, 0, "CONFIRMED", null], ["Famille Pambrun", 3, resDay, 12, 30, "CONFIRMED", "Gluten"], ["Sophie Martin", 4, resDay, 19, 30, "PENDING", null], ["Anniversaire Hina", 1, resDay, 20, 0, "CONFIRMED", "Fruits de mer"],
    ["Marc Dupont", 2, addDays(resDay, 1), 12, 15, "CONFIRMED", null], ["Séminaire Wing Chong", 5, addDays(resDay, 1), 19, 0, "PENDING", null], ["Tama Ariipeu", 5, addDays(resDay, -1), 19, 30, "COMPLETED", null], ["Client sans nom", 2, addDays(resDay, -1), 20, 0, "NO_SHOW", null],
  ];
  const partySizes = [2, 6, 2, 8, 2, 12, 4, 2];
  for (const [i, [name, ci, day, h, m, status, allergies]] of RES.entries()) {
    await prisma.reservation.create({ data: { establishmentId: est.id, customerId: customerIds[ci], name, phone: CUSTOMERS[ci][2], startsAt: resAt(day, h, m), partySize: partySizes[i], status: status as "CONFIRMED", allergies, notes: i === 3 ? "Gâteau à apporter, table près de la mer" : null } });
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
          establishmentId: est.id, categoryId: category.id, taxRateId: tax.id, kitchenStationId: stations[cat.station], name: p.name, description: p.desc ?? null, imageUrl: IMAGES[p.name] ?? null, priceTtc: p.price, costPrice: p.cost,
          sku: `${cat.category.slice(0, 3).toUpperCase()}-${String(pi + 1).padStart(3, "0")}`, sortOrder: pi, color: p.color ?? null,
          modifierGroups: p.mods ? { create: p.mods.map((m, i) => ({ modifierGroupId: groups[m], sortOrder: i })) } : undefined,
        },
      });
      productsByCategory[cat.category].push({ id: prod.id, name: prod.name, priceTtc: prod.priceTtc, costPrice: prod.costPrice, taxRateBps: tax.rateBps, taxRateName: tax.name, stationId: stations[cat.station], groups: p.mods ?? [] });
    }
  }
  const entrees = productsByCategory["Entrées"], plats = productsByCategory["Plats"], desserts = productsByCategory["Desserts"], boissons = productsByCategory["Boissons"];
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
  const modifierRows = await prisma.modifier.findMany({ include: { group: true } });

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
  // Mouvements des 7 derniers jours : ventes (recettes), achats, pertes
  for (let d = 7; d >= 0; d--) {
    const at = new Date(Date.now() - d * 86400000 - 3 * 3600000);
    for (const [ing, qty] of [["Thon rouge", between(600, 1400)], ["Steak haché 150 g", between(4, 12)], ["Pain burger", between(4, 12)], ["Hinano 33 cl", between(6, 18)], ["Coca-Cola 33 cl", between(4, 14)], ["Frites surgelées", 1.2 + rand()], ["Mahi-mahi", between(200, 600)]] as [string, number][]) {
      const ingRow = await prisma.ingredient.findUniqueOrThrow({ where: { id: ings[ing].id } });
      await prisma.inventoryMovement.create({ data: { establishmentId: est.id, ingredientId: ings[ing].id, kind: "SALE", quantity: -qty, unitCost: ingRow.avgCost, createdAt: at } });
    }
    if (d === 2) { await prisma.inventoryMovement.create({ data: { establishmentId: est.id, ingredientId: ings["Hinano 33 cl"].id, userId: manager.id, kind: "PURCHASE", quantity: 96, unitCost: 210, reason: `Réception BC-${poDay}-001`, createdAt: at } }); await prisma.inventoryMovement.create({ data: { establishmentId: est.id, ingredientId: ings["Coca-Cola 33 cl"].id, userId: manager.id, kind: "PURCHASE", quantity: 72, unitCost: 150, reason: `Réception BC-${poDay}-001`, createdAt: at } }); }
    if (d === 4) await prisma.inventoryMovement.create({ data: { establishmentId: est.id, ingredientId: ings["Thon rouge"].id, userId: manager.id, kind: "LOSS", quantity: -400, unitCost: 2, reason: "Périmé (DLC dépassée)", createdAt: at } });
    if (d === 1) await prisma.inventoryMovement.create({ data: { establishmentId: est.id, ingredientId: ings["Pain burger"].id, userId: manager.id, kind: "BREAKAGE", quantity: -6, unitCost: 90, reason: "Pains écrasés à la livraison", createdAt: at } });
  }
  // Un ingrédient critique en rupture pour illustrer l'indisponibilité automatique
  await prisma.ingredient.update({ where: { id: ings["Pâte à pizza"].id }, data: { stockQty: 0 } });
  await prisma.product.updateMany({ where: { id: byName("Pizza Reine")?.id ?? "" }, data: { autoUnavailable: true } });

  console.log("→ Commandes fictives (14 jours)…");
  const today = localDay(new Date(), TZ);
  let counter = 0;
  const mkOrder = async (day: string, hour: number, minute: number, tableIdx: number, close: boolean, serverIdx: number, cashSessionId: string | null) => {
    const openedAt = new Date(startOfLocalDay(day, TZ).getTime() + (hour * 60 + minute) * 60000);
    const covers = between(1, 5);
    const dayCounter = await prisma.orderCounter.upsert({ where: { establishmentId_day: { establishmentId: est.id, day } }, update: { value: { increment: 1 } }, create: { establishmentId: est.id, day, value: 1 } });
    const number = `${day.replace(/-/g, "")}-${String(dayCounter.value).padStart(4, "0")}`;
    const table = tables[tableIdx];
    const order = await prisma.order.create({ data: { establishmentId: est.id, number, type: "DINE_IN", tableId: table.id, serverId: servers[serverIdx].id, covers, openedAt, createdAt: openedAt, status: "OPEN", courses: { create: ["APÉRITIFS", "ENTRÉES", "PLATS", "DESSERTS"].map((name, i) => ({ name, sortOrder: i })) } } });
    const courses = await prisma.course.findMany({ where: { orderId: order.id }, orderBy: { sortOrder: "asc" } });
    const lines: { quantity: number; unitPrice: number; modifiersTotal: number; discountAmount: number; taxRateBps: number; taxRateName: string }[] = [];
    const picks: { p: (typeof plats)[number]; course: number }[] = [];
    for (let c = 0; c < covers; c++) {
      if (rand() < 0.5) picks.push({ p: pick(entrees), course: 1 });
      picks.push({ p: pick(plats), course: 2 });
      if (rand() < 0.45) picks.push({ p: pick(desserts), course: 3 });
      picks.push({ p: pick(boissons), course: 0 });
      if (rand() < 0.3) picks.push({ p: pick(boissons), course: 0 });
    }
    const sent = close || rand() < 0.7;
    const createdItems: { id: string; courseId: string; stationId: string | null | undefined; sentAt: Date | null }[] = [];
    for (const [i, { p, course }] of picks.entries()) {
      const mods = [];
      for (const gName of p.groups) {
        const g = MODIFIER_GROUPS.find((x) => x.name === gName)!;
        if (g.minSelect > 0) { const m = pick(modifierRows.filter((r) => r.group.name === gName)); mods.push(m); }
        else if (rand() < 0.35) { const m = pick(modifierRows.filter((r) => r.group.name === gName)); mods.push(m); }
      }
      const modifiersTotal = mods.reduce((a, m) => a + m.priceDelta, 0);
      const calc = computeLine({ quantity: 1, unitPrice: p.priceTtc, modifiersTotal, discountAmount: 0, taxRateBps: p.taxRateBps });
      lines.push({ quantity: 1, unitPrice: p.priceTtc, modifiersTotal, discountAmount: 0, taxRateBps: p.taxRateBps, taxRateName: p.taxRateName });
      const item = await prisma.orderItem.create({
        data: {
          orderId: order.id, courseId: courses[course].id, productId: p.id, kitchenStationId: p.stationId, name: p.name, quantity: 1, unitPrice: p.priceTtc, modifiersTotal, lineTotal: calc.lineTotal,
          taxRateBps: p.taxRateBps, taxRateName: p.taxRateName, taxAmount: calc.taxAmount, costPrice: p.costPrice, seatNumber: (i % covers) + 1, sortOrder: i, status: close ? "SERVED" : sent ? "SENT" : "PENDING",
          sentAt: sent ? new Date(openedAt.getTime() + 3 * 60000) : null, createdAt: openedAt,
          modifiers: { create: mods.map((m) => ({ modifierId: m.id, groupName: m.group.name, name: m.name, priceDelta: m.priceDelta })) },
        },
      });
      createdItems.push({ id: item.id, courseId: courses[course].id, stationId: p.stationId, sentAt: item.sentAt });
    }
    // Tickets cuisine (Phase 3) : un ticket par (service, poste) pour les commandes en cours envoyées
    if (sent && !close) {
      const groups = new Map<string, typeof createdItems>();
      for (const it of createdItems) { const k = `${it.courseId}|${it.stationId ?? "none"}`; groups.set(k, [...(groups.get(k) ?? []), it]); }
      for (const [k, items] of groups) {
        const [courseId, stationId] = k.split("|");
        const r = rand();
        const status = r < 0.35 ? "NEW" : r < 0.55 ? "ACCEPTED" : r < 0.85 ? "IN_PROGRESS" : "READY";
        const at = items[0].sentAt ?? openedAt;
        const later = (min: number) => new Date(at.getTime() + min * 60000);
        const ticket = await prisma.kitchenTicket.create({ data: { orderId: order.id, courseId, stationId: stationId === "none" ? null : stationId, status, isUrgent: rand() < 0.12, createdAt: at, acceptedAt: status === "NEW" ? null : later(1), startedAt: status === "NEW" || status === "ACCEPTED" ? null : later(2), readyAt: status === "READY" ? later(9) : null } });
        await prisma.orderItem.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { kitchenTicketId: ticket.id, ...(status === "IN_PROGRESS" ? { status: "PREPARING" } : status === "READY" ? { status: "READY", readyAt: later(9) } : {}) } });
        if (status === "READY") await prisma.course.update({ where: { id: courseId }, data: { status: "READY" } });
      }
    }
    const discount = rand() < 0.08 ? 500 : 0;
    const totals = computeOrderTotals(lines, discount);
    if (close) {
      const closedAt = new Date(openedAt.getTime() + between(45, 110) * 60000);
      const method = rand() < 0.55 ? "CARD" : rand() < 0.85 ? "CASH" : "MEAL_VOUCHER";
      const tip = method === "CARD" && rand() < 0.3 ? Math.round(totals.total * 0.05 / 100) * 100 : 0;
      const split = method === "CARD" && covers >= 2 && rand() < 0.25;
      const amounts = split ? [Math.floor(totals.total / 2), totals.total - Math.floor(totals.total / 2)] : [totals.total];
      for (const [i, amount] of amounts.entries()) {
        const pay = await prisma.payment.create({ data: { establishmentId: est.id, orderId: order.id, cashSessionId, receivedById: servers[serverIdx].id, method, amount, tipAmount: i === 0 ? tip : 0, tendered: method === "CASH" ? Math.ceil((amount + tip) / 1000) * 1000 : null, changeGiven: method === "CASH" ? Math.ceil((amount + tip) / 1000) * 1000 - amount - tip : 0, splitLabel: split ? `Part ${i + 1}/2` : null, createdAt: closedAt } });
        if (method === "CASH" && cashSessionId) await prisma.cashMovement.create({ data: { cashSessionId, userId: servers[serverIdx].id, paymentId: pay.id, orderId: order.id, kind: "SALE", amount: amount + tip, reason: `Vente ${number}`, createdAt: closedAt } });
      }
      await prisma.order.update({ where: { id: order.id }, data: { status: "PAID", closedAt, subtotal: totals.subtotal, discountTotal: totals.discountTotal, discountReason: discount ? "Geste commercial" : null, taxTotal: totals.taxTotal, total: totals.total, paidTotal: totals.total, tipTotal: tip } });
    } else {
      await prisma.order.update({ where: { id: order.id }, data: { status: sent ? "SENT" : "OPEN", subtotal: totals.subtotal, discountTotal: totals.discountTotal, taxTotal: totals.taxTotal, total: totals.total } });
    }
    counter++;
  };

  for (let d = 14; d >= 1; d--) {
    const day = addDays(today, -d);
    const dow = new Date(day + "T12:00:00Z").getUTCDay();
    const lunch = dow === 0 || dow === 6 ? between(18, 26) : between(10, 18);
    const dinner = dow === 0 ? 0 : dow === 5 || dow === 6 ? between(16, 24) : between(8, 14);
    const session = await prisma.cashSession.create({ data: { establishmentId: est.id, openedById: manager.id, closedById: manager.id, status: "CLOSED", openingFloat: 30000, openedAt: new Date(startOfLocalDay(day, TZ).getTime() + 10.5 * 3600000), closedAt: new Date(endOfLocalDay(day, TZ).getTime() - 1.5 * 3600000) } });
    await prisma.cashMovement.create({ data: { cashSessionId: session.id, userId: manager.id, kind: "OPENING", amount: 30000, reason: "Fond de caisse", createdAt: session.openedAt } });
    for (let i = 0; i < lunch; i++) await mkOrder(day, between(11, 13), between(0, 59), between(0, 19), true, between(0, 4), session.id);
    for (let i = 0; i < dinner; i++) await mkOrder(day, between(18, 21), between(0, 59), between(0, 19), true, between(0, 4), session.id);
    const movements = await prisma.cashMovement.findMany({ where: { cashSessionId: session.id } });
    const expected = movements.reduce((a, m) => a + m.amount, 0);
    const counted = expected + (rand() < 0.2 ? pick([-500, -100, 100, 200]) : 0);
    await prisma.cashSession.update({ where: { id: session.id }, data: { expectedCash: expected, countedCash: counted, difference: counted - expected } });
  }
  // Aujourd'hui : session ouverte, quelques commandes payées et des tables occupées
  const todaySession = await prisma.cashSession.create({ data: { establishmentId: est.id, openedById: manager.id, status: "OPEN", openingFloat: 30000, openedAt: new Date(Date.now() - 3 * 3600000) } });
  await prisma.cashMovement.create({ data: { cashSessionId: todaySession.id, userId: manager.id, kind: "OPENING", amount: 30000, reason: "Fond de caisse", createdAt: todaySession.openedAt } });
  const nowLocalHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  for (let i = 0; i < 6; i++) await mkOrder(today, Math.max(0, nowLocalHour - 2), between(0, 40), between(0, 19), true, between(0, 4), todaySession.id);
  const openTables = [0, 3, 5, 14, 16];
  for (const [i, t] of openTables.entries()) await mkOrder(today, Math.max(0, nowLocalHour - (i % 2)), between(0, 30), t, false, i % 5, todaySession.id);

  console.log("→ Commandes en ligne et borne en attente…");
  const mkOnline = async (type: "ONLINE" | "DELIVERY" | "KIOSK", ci: number | null, picks: typeof plats, meta: Record<string, unknown>, accepted: boolean) => {
    const n = `${today.replace(/-/g, "")}-${String(counter + 1).padStart(4, "0")}`; counter++;
    const o = await prisma.order.create({ data: { establishmentId: est.id, number: n, type, serverId: owner.id, covers: 1, customerId: ci !== null ? customerIds[ci] : null, customerName: ci !== null ? `${CUSTOMERS[ci][0]} ${CUSTOMERS[ci][1]}` : (meta.name as string) ?? null, status: accepted ? "SENT" : "OPEN", publicToken: crypto.randomUUID(), channelMeta: { ...meta, channel: type === "KIOSK" ? "KIOSK" : type === "DELIVERY" ? "DELIVERY" : "PICKUP", awaitingAcceptance: !accepted }, acceptedAt: accepted ? new Date(Date.now() - 6 * 60000) : null, openedAt: new Date(Date.now() - 9 * 60000), courses: { create: [{ name: "COMMANDE", sortOrder: 0, status: accepted ? "SENT" : "PENDING" }] } } });
    const course = await prisma.course.findFirstOrThrow({ where: { orderId: o.id } });
    const lines = picks.map((p) => computeLine({ quantity: 1, unitPrice: p.priceTtc, modifiersTotal: 0, discountAmount: 0, taxRateBps: p.taxRateBps }));
    for (const [i, p] of picks.entries()) await prisma.orderItem.create({ data: { orderId: o.id, courseId: course.id, productId: p.id, kitchenStationId: p.stationId, name: p.name, quantity: 1, unitPrice: p.priceTtc, lineTotal: lines[i].lineTotal, taxRateBps: p.taxRateBps, taxRateName: p.taxRateName, taxAmount: lines[i].taxAmount, costPrice: p.costPrice, sortOrder: i, status: accepted ? "SENT" : "PENDING", sentAt: accepted ? new Date(Date.now() - 6 * 60000) : null } });
    const totals = computeOrderTotals(lines.map((l, i) => ({ quantity: 1, unitPrice: picks[i].priceTtc, modifiersTotal: 0, discountAmount: 0, taxRateBps: picks[i].taxRateBps, taxRateName: picks[i].taxRateName })), 0);
    await prisma.order.update({ where: { id: o.id }, data: { subtotal: totals.subtotal, taxTotal: totals.taxTotal, total: totals.total } });
    if (accepted) await prisma.kitchenTicket.create({ data: { orderId: o.id, courseId: course.id, stationId: picks[0].stationId, status: "IN_PROGRESS", createdAt: new Date(Date.now() - 6 * 60000), acceptedAt: new Date(Date.now() - 5 * 60000), startedAt: new Date(Date.now() - 4 * 60000), items: { connect: [] } } });
  };
  await mkOnline("ONLINE", 1, [plats[0], entrees[1], boissons[0]], { name: "Hina Tetuanui", phone: "+689 87 44 55 66", when: "12:30", lang: "fr" }, false);
  await mkOnline("DELIVERY", 3, [plats[2], plats[6], desserts[0], boissons[2]], { name: "Vaimiti Pambrun", phone: "+689 87 99 88 77", when: "Dès que possible", address: "PK 15,8 côté montagne, portail vert", zone: "Punaauia", deliveryFee: 500, lang: "fr" }, false);
  await mkOnline("KIOSK", null, [plats[1], boissons[1]], { name: "Moe", mode: "TAKEAWAY", payAtCounter: true, lang: "en" }, true);

  // Phase 9 : parcours de service et rappels pour les tables en cours (un rappel antidaté pour montrer le retard)
  const { startTracking, onTicketReady } = await import("../src/server/services/service-tracking");
  const liveOrders = await prisma.order.findMany({ where: { establishmentId: est.id, type: "DINE_IN", status: { in: ["OPEN", "SENT", "BILL_REQUESTED"] } }, include: { kitchenTickets: { include: { items: true } } } });
  for (const o of liveOrders) {
    const actor = { organizationId: org.id, establishmentId: est.id, userId: o.serverId ?? owner.id };
    await prisma.$transaction(async (tx) => startTracking(tx, actor, o));
    for (const t of o.kitchenTickets.filter((t) => t.status === "READY")) await onTicketReady(actor, { id: t.id, orderId: o.id, items: t.items, order: { tableId: o.tableId, serverId: o.serverId, type: o.type } });
  }
  const firstReminder = await prisma.serviceReminder.findFirst({ where: { establishmentId: est.id, status: "OPEN", kind: "TAKE_ORDER" }, orderBy: { createdAt: "asc" } });
  if (firstReminder) await prisma.serviceReminder.update({ where: { id: firstReminder.id }, data: { dueAt: new Date(Date.now() - 9 * 60000) } });

  await prisma.auditLog.create({ data: { organizationId: org.id, establishmentId: est.id, userId: owner.id, action: "demo.seed", entityType: "establishment", entityId: est.id, newValue: { orders: counter } } });
  console.log(`✓ Démo créée : ${counter} commandes. Connexion : demo@manaresto.pf / demo1234 (PIN 1234)`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
