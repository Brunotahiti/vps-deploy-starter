import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { resetAttempts } from "@/server/auth/attempts";
import { createPinUser, isPinOnlyEmail, listUsers, pinTeam, updateUser } from "@/server/services/users";
import { loginWithPassword } from "@/server/services/auth";
import { verifyPin } from "@/server/auth/password";

let T: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  await resetAttempts();
  T = await makeTenant("pin-accounts");
});

describe("Comptes employés « PIN seul »", () => {
  it("se crée avec prénom, nom, profil et PIN, sans e-mail ni mot de passe", async () => {
    const u = await createPinUser(T.org.id, T.manager.id, { firstName: "Moana", lastName: "Teriipaia", pin: "5151", color: "#EC4899", memberships: [{ establishmentId: T.est.id, roleId: T.roles.server }] });
    expect(u.pinOnly).toBe(true);
    expect(isPinOnlyEmail(u.email)).toBe(true);
    expect(await verifyPin("5151", u.pinHash)).toBe(true);
    // Le PIN est unique dans l'établissement : 1001 est celui du serveur du jeu de test
    await expect(createPinUser(T.org.id, T.manager.id, { firstName: "Hina", lastName: "Doublon", pin: "1001", memberships: [{ establishmentId: T.est.id, roleId: T.roles.server }] })).rejects.toMatchObject({ code: "PIN_TAKEN" });
    // Impossible de se connecter par e-mail / mot de passe : ce compte n'a pas d'identifiants, seulement son PIN
    await expect(loginWithPassword(u.email, "n'importe quoi")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("la liste des utilisateurs ne montre pas l'adresse interne ; l'équipe de l'écran PIN est publique et sans données sensibles", async () => {
    const users = await listUsers(T.org.id, T.est.id);
    const moana = users.find((x) => x.firstName === "Moana")!;
    expect(moana.pinOnly).toBe(true);
    expect(moana.email).toBe("");
    expect(moana.hasPin).toBe(true);
    const team = await pinTeam(T.est.id);
    const m = team.find((x) => x.name === "Moana")!;
    expect(m).toMatchObject({ initials: "MT", color: "#EC4899", roleKey: "server" });
    expect(Object.keys(m).sort()).toEqual(["color", "id", "initials", "name", "roleKey", "roleName"]);
    // Le propriétaire (PIN 9999) et le manager y figurent aussi ; un compte sans PIN n'y est pas
    expect(team.some((x) => x.roleKey === "owner")).toBe(true);
    await prisma.user.create({ data: { organizationId: T.org.id, email: "sanspin@test.pf", passwordHash: "x", firstName: "Sans", lastName: "Pin", memberships: { create: { establishmentId: T.est.id, roleId: T.roles.server } } } });
    expect((await pinTeam(T.est.id)).some((x) => x.name === "Sans")).toBe(false);
  });

  it("devient un compte complet quand on lui donne une adresse et un mot de passe", async () => {
    const moana = (await prisma.user.findFirstOrThrow({ where: { firstName: "Moana", organizationId: T.org.id } }));
    await updateUser(T.org.id, T.owner.id, moana.id, { email: "moana@test.pf", password: "motdepasse1" });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: moana.id } });
    expect(after.pinOnly).toBe(false);
    expect(after.email).toBe("moana@test.pf");
  });
});
