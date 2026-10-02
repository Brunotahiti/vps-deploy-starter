import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { assertCanAssign, assertCanManageUser } from "@/server/auth/guards";
import { PROFILES, profileHome } from "@/lib/profiles";

let T: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("profils");
});

const ctxOf = async (userId: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: { include: { role: { include: { permissions: true } } } } } });
  const permissions = new Set<string>(user.isOwner ? ["*"] : user.memberships.flatMap((m) => m.role.permissions.map((p) => p.permissionKey)));
  return { user, permissions, organizationId: user.organizationId, establishment: { id: T.est.id } };
};
const permsOf = async (key: string) => (await prisma.role.findFirstOrThrow({ where: { organizationId: T.org.id, key }, include: { permissions: true } })).permissions.map((p) => p.permissionKey).sort();

describe("Profils : Admin, Gérant, Chef en cuisine, Équipe en salle", () => {
  it("chaque entreprise a les quatre profils, avec leurs noms", async () => {
    const roles = await prisma.role.findMany({ where: { organizationId: T.org.id }, select: { key: true, name: true } });
    const name = Object.fromEntries(roles.map((r) => [r.key, r.name]));
    expect(name).toMatchObject({ admin: "Admin", manager: "Gérant", kitchen: "Chef en cuisine", server: "Équipe en salle", owner: "Admin (propriétaire)" });
    expect(PROFILES.map((p) => p.key)).toEqual(["admin", "manager", "kitchen", "server"]);
  });

  it("droits de chaque profil : le chef gère carte et stocks sans la caisse ; l'équipe en salle encaisse sans remise", async () => {
    const all = (await prisma.permission.count());
    expect((await permsOf("admin")).length).toBe(all);
    const manager = await permsOf("manager");
    expect(manager).toEqual(expect.arrayContaining(["users.manage", "catalog.manage", "pos.refund", "stock.manage", "reports.view"]));
    expect(manager).not.toContain("establishments.manage");
    const chef = await permsOf("kitchen");
    expect(chef).toEqual(expect.arrayContaining(["kds.use", "catalog.manage", "catalog.availability", "stock.manage"]));
    expect(chef.some((p) => p.startsWith("pos.") || p.startsWith("cash.") || p === "reports.view" || p === "users.manage")).toBe(false);
    const salle = await permsOf("server");
    expect(salle).toEqual(expect.arrayContaining(["pos.use", "customers.manage"]));
    expect(salle).not.toContain("pos.discount");
    expect(salle).not.toContain("pos.refund");
    expect(salle).not.toContain("catalog.manage");
  });

  it("un gérant ne peut pas nommer d'admin ; le propriétaire et un admin le peuvent", async () => {
    const mgr = await ctxOf(T.manager.id);
    await expect(assertCanAssign(mgr, [{ establishmentId: T.est.id, roleId: T.roles.admin }])).rejects.toMatchObject({ status: 403 });
    await expect(assertCanAssign(mgr, [{ establishmentId: T.est.id, roleId: T.roles.kitchen }])).resolves.toBeUndefined();
    await expect(assertCanAssign(await ctxOf(T.owner.id), [{ establishmentId: T.est.id, roleId: T.roles.admin }])).resolves.toBeUndefined();
    const admin = await prisma.user.create({ data: { organizationId: T.org.id, email: "admin-profils@test.pf", passwordHash: "x", firstName: "Ad", lastName: "Min", memberships: { create: { establishmentId: T.est.id, roleId: T.roles.admin } } } });
    const adminCtx = await ctxOf(admin.id);
    await expect(assertCanAssign(adminCtx, [{ establishmentId: T.est.id, roleId: T.roles.admin }])).resolves.toBeUndefined();
    // Un gérant ne modifie pas un admin (plus puissant que lui) ; un admin ne modifie pas le propriétaire
    await expect(assertCanManageUser(mgr, admin.id)).rejects.toMatchObject({ status: 403 });
    await expect(assertCanManageUser(adminCtx, T.owner.id)).rejects.toMatchObject({ status: 403, code: "OWNER" });
    await expect(assertCanManageUser(adminCtx, T.manager.id)).resolves.toBeUndefined();
  });

  it("écran d'accueil : cuisine pour le chef, salle pour l'équipe, gestion pour admin et gérant", () => {
    expect(profileHome("kitchen", false)).toBe("/kds");
    expect(profileHome("server", false)).toBe("/pos");
    expect(profileHome("manager", false)).toBe("/admin");
    expect(profileHome("admin", false)).toBe("/admin");
    expect(profileHome(null, true)).toBe("/admin");
    expect(profileHome("accountant", false)).toBeNull();
  });
});
