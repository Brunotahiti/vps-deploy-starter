import { prisma } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { ensureSystemRoles } from "@/server/services/roles";
import { createEstablishmentDefaults } from "@/server/services/establishments";
import { createProduct, upsertCategory, upsertModifierGroup, upsertMenu } from "@/server/services/catalog";
import { upsertRoom, upsertTable } from "@/server/services/floor";
import type { Actor } from "@/server/services/orders";

/** Crée une entreprise complète (établissement, propriétaire, serveur, catalogue minimal, salle). */
export async function makeTenant(slug: string) {
  const org = await prisma.organization.create({ data: { name: `Org ${slug}`, slug } });
  await ensureSystemRoles(org.id);
  const est = await prisma.establishment.create({ data: { organizationId: org.id, name: `Resto ${slug}`, slug } });
  await createEstablishmentDefaults(est.id);
  const roles = Object.fromEntries((await prisma.role.findMany({ where: { organizationId: org.id } })).map((r) => [r.key, r.id]));
  const pw = await hashPassword("password123");
  const owner = await prisma.user.create({ data: { organizationId: org.id, email: `owner-${slug}@test.pf`, passwordHash: pw, pinHash: await hashPassword("9999"), firstName: "Owner", lastName: slug, isOwner: true } });
  const manager = await prisma.user.create({ data: { organizationId: org.id, email: `manager-${slug}@test.pf`, passwordHash: pw, pinHash: await hashPassword("2000"), firstName: "Manager", lastName: slug, memberships: { create: { establishmentId: est.id, roleId: roles.manager } } } });
  const server = await prisma.user.create({ data: { organizationId: org.id, email: `server-${slug}@test.pf`, passwordHash: pw, pinHash: await hashPassword("1001"), firstName: "Server", lastName: slug, memberships: { create: { establishmentId: est.id, roleId: roles.server } } } });
  const actor: Actor = { organizationId: org.id, establishmentId: est.id, userId: server.id };
  const managerActor: Actor = { organizationId: org.id, establishmentId: est.id, userId: manager.id };
  const taxRates = await prisma.taxRate.findMany({ where: { establishmentId: est.id } });
  const tax13 = taxRates.find((t) => t.rateBps === 1300)!;
  const tax16 = taxRates.find((t) => t.rateBps === 1600)!;
  const tax0 = taxRates.find((t) => t.rateBps === 0)!;
  const cat = await upsertCategory(managerActor, { name: "Plats" });
  const cuisson = await upsertModifierGroup(managerActor, { name: "Cuisson", minSelect: 1, maxSelect: 1, modifiers: [{ name: "Saignant", priceDelta: 0 }, { name: "À point", priceDelta: 0, isDefault: true }] });
  const supp = await upsertModifierGroup(managerActor, { name: "Suppléments", minSelect: 0, maxSelect: null, modifiers: [{ name: "Bacon", priceDelta: 250 }, { name: "Fromage", priceDelta: 150 }] });
  const burger = await createProduct(managerActor, { name: "Burger", priceTtc: 2100, costPrice: 630, categoryId: cat.id, taxRateId: tax13.id, modifierGroupIds: [cuisson.id, supp.id] });
  const biere = await createProduct(managerActor, { name: "Bière", priceTtc: 600, costPrice: 210, categoryId: cat.id, taxRateId: tax16.id });
  const eau = await createProduct(managerActor, { name: "Eau", priceTtc: 300, costPrice: 90, categoryId: cat.id, taxRateId: tax0.id });
  const entree = await createProduct(managerActor, { name: "Salade", priceTtc: 1200, costPrice: 300, categoryId: cat.id, taxRateId: tax13.id });
  const menu = await upsertMenu(managerActor, { name: "Menu", priceTtc: 3500, taxRateId: tax13.id, sections: [{ name: "Entrée", minSelect: 1, maxSelect: 1, items: [{ productId: entree.id, supplement: 0 }] }, { name: "Plat", minSelect: 1, maxSelect: 1, items: [{ productId: burger.id, supplement: 500 }] }] });
  const room = await upsertRoom(managerActor, { name: "Salle" });
  const t1 = await upsertTable(managerActor, { roomId: room.id, name: "T01", seats: 4 });
  const t2 = await upsertTable(managerActor, { roomId: room.id, name: "T02", seats: 2 });
  return { org, est, owner, manager, server, actor, managerActor, roles, tax13, tax16, tax0, cat, cuisson, supp, burger, biere, eau, entree, menu, room, t1, t2 };
}
