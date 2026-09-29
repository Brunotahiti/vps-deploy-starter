import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { listProducts, createProduct, getPosCatalog, setProductAvailability, importProducts } from "@/server/services/catalog";
import { getFloorStatus } from "@/server/services/floor";
import { hashPassword, verifyPassword, verifyPin } from "@/server/auth/password";
import { authorizeWithManagerPin } from "@/server/services/auth";
import { createUser, updateUser } from "@/server/services/users";
import { updateRole } from "@/server/services/roles";
import { hasPermission } from "@/lib/permissions";

let A: Awaited<ReturnType<typeof makeTenant>>;
let B: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  A = await makeTenant("a");
  B = await makeTenant("b");
});

describe("isolation multi-tenant", () => {
  it("les catalogues, salles et commandes ne se mélangent jamais", async () => {
    const pa = await listProducts(A.est.id);
    const pb = await listProducts(B.est.id);
    expect(pa.every((p) => p.establishmentId === A.est.id)).toBe(true);
    expect(pb.every((p) => p.establishmentId === B.est.id)).toBe(true);
    expect(pa.map((p) => p.id).some((id) => pb.map((p) => p.id).includes(id))).toBe(false);
    const fa = await getFloorStatus(A.est.id);
    expect(fa.rooms.flatMap((r) => r.tables).every((t) => t.establishmentId === A.est.id)).toBe(true);
  });
  it("refuse de lier un produit à une catégorie / TVA d'un autre établissement", async () => {
    await expect(createProduct(A.managerActor, { name: "X", priceTtc: 100, categoryId: B.cat.id })).rejects.toMatchObject({ code: "BAD_CATEGORY" });
    await expect(createProduct(A.managerActor, { name: "X", priceTtc: 100, taxRateId: B.tax13.id })).rejects.toMatchObject({ code: "BAD_TAX" });
    await expect(createProduct(A.managerActor, { name: "X", priceTtc: 100, modifierGroupIds: [B.cuisson.id] })).rejects.toMatchObject({ code: "BAD_MODIFIER_GROUP" });
  });
  it("un manager ne peut pas rendre indisponible un produit d'un autre établissement", async () => {
    await expect(setProductAvailability(A.managerActor, B.burger.id, false)).rejects.toMatchObject({ status: 404 });
  });
  it("le PIN manager d'un établissement ne fonctionne pas dans l'autre", async () => {
    await expect(authorizeWithManagerPin(B.est.id, "2000", "pos.discount")).resolves.toBeTruthy();
    // Le PIN 2000 existe aussi dans A (même valeur) : chaque établissement ne voit que ses membres → autorisé par le manager de A, pas de B
    const u = await authorizeWithManagerPin(A.est.id, "2000", "pos.discount");
    expect(u.organizationId).toBe(A.org.id);
    // Le PIN serveur ne détient pas la permission
    await expect(authorizeWithManagerPin(A.est.id, "1001", "pos.discount")).rejects.toMatchObject({ code: "PIN_NOT_AUTHORIZED" });
    await expect(authorizeWithManagerPin(A.est.id, "0000", "pos.discount")).rejects.toMatchObject({ code: "INVALID_PIN" });
  });
});

describe("mots de passe, PIN, utilisateurs et rôles", () => {
  it("hachage scrypt vérifiable, non réversible", async () => {
    const h = await hashPassword("secret123");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("secret123", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPin("1234", null)).toBe(false);
  });
  it("crée un utilisateur avec rôle, refuse les doublons d'email et les rôles d'une autre entreprise", async () => {
    const u = await createUser(A.org.id, A.owner.id, { email: "new@a.pf", password: "password123", firstName: "N", lastName: "U", pin: "4321", memberships: [{ establishmentId: A.est.id, roleId: A.roles.cashier }] });
    expect(u.pinHash).toBeTruthy();
    await expect(createUser(A.org.id, A.owner.id, { email: "new@a.pf", password: "password123", firstName: "N", lastName: "U", memberships: [{ establishmentId: A.est.id, roleId: A.roles.cashier }] })).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
    await expect(createUser(A.org.id, A.owner.id, { email: "x@a.pf", password: "password123", firstName: "N", lastName: "U", memberships: [{ establishmentId: A.est.id, roleId: B.roles.cashier }] })).rejects.toMatchObject({ code: "BAD_MEMBERSHIP" });
    await expect(createUser(A.org.id, A.owner.id, { email: "y@a.pf", password: "password123", firstName: "N", lastName: "U", memberships: [{ establishmentId: A.est.id, roleId: A.roles.owner }] })).rejects.toMatchObject({ code: "OWNER_ROLE" });
    await expect(updateUser(A.org.id, A.owner.id, B.server.id, { firstName: "hack" })).rejects.toMatchObject({ status: 404 });
    expect(await prisma.auditLog.count({ where: { organizationId: A.org.id, action: "user.create" } })).toBe(1);
  });
  it("les permissions d'un rôle sont modifiables, sauf le rôle propriétaire", async () => {
    const r = await updateRole(A.org.id, A.roles.server, { permissions: ["pos.use", "pos.discount"] });
    expect(hasPermission(r.permissions.map((p) => p.permissionKey), "pos.discount")).toBe(true);
    await expect(updateRole(A.org.id, A.roles.owner, { name: "x" })).rejects.toMatchObject({ code: "OWNER_ROLE" });
    await expect(updateRole(B.org.id, A.roles.server, { name: "x" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("catalogue", () => {
  it("le snapshot POS contient catégories, produits avec options, formules, TVA et moyens de paiement", async () => {
    const c = await getPosCatalog(A.est.id);
    expect(c.categories.length).toBe(1);
    expect(c.products.find((p) => p.name === "Burger")!.modifierGroups.length).toBe(2);
    expect(c.menus.length).toBe(1);
    expect(c.taxRates.length).toBe(4);
    expect(c.paymentMethods.map((m) => m.method)).toContain("CASH");
  });
  it("import CSV : création, mise à jour par référence, catégorie et taux créés à la volée", async () => {
    const r1 = await importProducts(A.managerActor, [{ category: "Desserts", name: "Tarte coco", priceTtc: 1000, taxRateBps: 1300, costPrice: 260, sku: "DES-001" }, { category: "Desserts", name: "Glace", priceTtc: 800, taxRateBps: 800, sku: "DES-002" }]);
    expect(r1).toMatchObject({ createdCount: 2, updatedCount: 0 });
    const r2 = await importProducts(A.managerActor, [{ category: "Desserts", name: "Tarte coco maison", priceTtc: 1100, sku: "DES-001" }]);
    expect(r2).toMatchObject({ createdCount: 0, updatedCount: 1 });
    const p = await prisma.product.findFirst({ where: { establishmentId: A.est.id, sku: "DES-001" } });
    expect(p?.name).toBe("Tarte coco maison");
    expect(await prisma.taxRate.count({ where: { establishmentId: A.est.id, rateBps: 800 } })).toBe(1);
  });
});
