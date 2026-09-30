import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { sentMails } from "@/server/email/mailer";
import { acceptInvitation, getInvitation, inviteUser, resendInvite } from "@/server/services/invitations";
import { loginWithPassword } from "@/server/services/auth";
import { listUsers } from "@/server/services/users";

let T: Awaited<ReturnType<typeof makeTenant>>;
let serverRoleId: string;

beforeAll(async () => {
  process.env.EMAIL_TRANSPORT = "memory";
  process.env.PUBLIC_URL = "https://app.test.pf";
  await resetDb();
  T = await makeTenant("invite");
  serverRoleId = (await prisma.role.findFirstOrThrow({ where: { organizationId: T.org.id, key: "server" } })).id;
});

describe("Invitations par e-mail", () => {
  let token: string;
  it("invite : compte créé avec ses rôles, e-mail envoyé avec le lien, visible en attente", async () => {
    const before = sentMails.length;
    const r = await inviteUser(T.org.id, { id: T.owner.id, name: "Owner" }, { email: "Hina@Test.pf", firstName: "Hina", lastName: "Teriitahi", memberships: [{ establishmentId: T.est.id, roleId: serverRoleId }] });
    expect(r.email).toBe("hina@test.pf");
    expect(r.emailSent).toBe(true);
    expect(r.inviteUrl).toMatch(/^https:\/\/app\.test\.pf\/invitation\/[A-Za-z0-9_-]{32}$/);
    expect(sentMails.length).toBe(before + 1);
    expect(sentMails.at(-1)!.to).toBe("hina@test.pf");
    expect(sentMails.at(-1)!.html).toContain(r.inviteUrl);
    token = r.inviteUrl.split("/").pop()!;
    const u = (await listUsers(T.org.id)).find((x) => x.email === "hina@test.pf")!;
    expect(u.invitePending).toBe(true);
    expect(u).not.toHaveProperty("inviteToken");
    const inv = await getInvitation(token);
    expect(inv).toMatchObject({ firstName: "Hina", organizationName: T.org.name, expired: false });
    expect(inv.memberships[0].role).toBeTruthy();
  });
  it("refuse un e-mail déjà utilisé et le rôle propriétaire", async () => {
    await expect(inviteUser(T.org.id, { id: T.owner.id, name: "Owner" }, { email: "hina@test.pf", firstName: "X", lastName: "Y", memberships: [{ establishmentId: T.est.id, roleId: serverRoleId }] })).rejects.toMatchObject({ status: 409 });
    const ownerRole = await prisma.role.findFirstOrThrow({ where: { organizationId: T.org.id, key: "owner" } });
    await expect(inviteUser(T.org.id, { id: T.owner.id, name: "Owner" }, { email: "z@test.pf", firstName: "X", lastName: "Y", memberships: [{ establishmentId: T.est.id, roleId: ownerRole.id }] })).rejects.toMatchObject({ status: 400 });
  });
  it("le mot de passe temporaire ne permet pas de se connecter ; l'acceptation fixe mot de passe et PIN puis le jeton est consommé", async () => {
    await expect(loginWithPassword("hina@test.pf", "n-importe-quoi")).rejects.toMatchObject({ status: 401 });
    const { user, establishmentId } = await acceptInvitation(token, { password: "motdepasse1", pin: "4321" });
    expect(user.inviteToken).toBeNull();
    expect(establishmentId).toBe(T.est.id);
    await expect(getInvitation(token)).rejects.toMatchObject({ status: 404 });
    await expect(acceptInvitation(token, { password: "autre-mdp-12" })).rejects.toMatchObject({ status: 404 });
    const u = (await listUsers(T.org.id)).find((x) => x.email === "hina@test.pf")!;
    expect(u.invitePending).toBe(false);
    expect(u.hasPin).toBe(true);
  });
  it("renvoi : nouveau jeton, l'ancien devient invalide ; une invitation expirée est refusée", async () => {
    const r = await inviteUser(T.org.id, { id: T.owner.id, name: "Owner" }, { email: "moana@test.pf", firstName: "Moana", lastName: "Tama", memberships: [{ establishmentId: T.est.id, roleId: serverRoleId }] });
    const t1 = r.inviteUrl.split("/").pop()!;
    const r2 = await resendInvite(T.org.id, { id: T.owner.id, name: "Owner" }, r.id);
    const t2 = r2.inviteUrl.split("/").pop()!;
    expect(t2).not.toBe(t1);
    await expect(getInvitation(t1)).rejects.toMatchObject({ status: 404 });
    await prisma.user.update({ where: { id: r.id }, data: { inviteExpiresAt: new Date(Date.now() - 1000) } });
    expect((await getInvitation(t2)).expired).toBe(true);
    await expect(acceptInvitation(t2, { password: "motdepasse1" })).rejects.toMatchObject({ status: 410 });
    await expect(resendInvite(T.org.id, { id: T.owner.id, name: "Owner" }, T.manager.id)).rejects.toMatchObject({ status: 400 });
  });
});
