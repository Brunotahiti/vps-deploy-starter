import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { sentMails } from "@/server/email/mailer";
import { createSession, findSessionByToken } from "@/server/auth/session";
import { loginWithPassword } from "@/server/services/auth";
import { platformOrgDetail, platformOverview, recordActivity, setOrganizationBlocked, setOrganizationPlan } from "@/server/services/platform";
import { emailSettings, explainSmtpError, runLifecycleEmails, sendManualEmail, sendSignupAlert, sendTestEmail, sendWelcomeEmail, teamRecipients } from "@/server/services/platform-emails";
import { isPlatformAdminEmail } from "@/server/auth/platform";

const DAY = 86_400_000;
let A: Awaited<ReturnType<typeof makeTenant>>;
let B: Awaited<ReturnType<typeof makeTenant>>;
const admin = { id: "", email: "admin@manaresto.com" };

beforeAll(async () => {
  process.env.EMAIL_TRANSPORT = "memory";
  process.env.PLATFORM_ADMIN_EMAILS = "Admin@ManaResto.com, autre@manaresto.com";
  await resetDb();
  A = await makeTenant("plat-a");
  B = await makeTenant("plat-b");
  admin.id = A.owner.id;
});

describe("Console plateforme", () => {
  it("reconnaît les administrateurs de la plateforme (insensible à la casse)", () => {
    expect(isPlatformAdminEmail("admin@manaresto.com")).toBe(true);
    expect(isPlatformAdminEmail("AUTRE@manaresto.com")).toBe(true);
    expect(isPlatformAdminEmail("owner-plat-a@test.pf")).toBe(false);
  });

  it("battement d'activité : une minute au plus toutes les 45 s, cumul par jour", async () => {
    const t0 = new Date("2026-09-20T20:00:00Z");
    await recordActivity(B.org.id, B.owner.id, t0);
    await recordActivity(B.org.id, B.owner.id, new Date(t0.getTime() + 10_000)); // ignoré
    await recordActivity(B.org.id, B.owner.id, new Date(t0.getTime() + 60_000));
    await recordActivity(B.org.id, B.server.id, new Date(t0.getTime() + 60_000));
    const rows = await prisma.activityDay.findMany({ where: { organizationId: B.org.id }, orderBy: { minutes: "desc" } });
    expect(rows.map((r) => r.minutes)).toEqual([2, 1]);
    const ov = await platformOverview(new Date("2026-09-22T20:00:00Z"));
    const row = ov.rows.find((r) => r.id === B.org.id)!;
    expect(row.minutes7).toBe(3);
    expect(row.minutes30).toBe(3);
    expect(row.activeDays30).toBe(1);
    expect(row.owner?.email).toBe("owner-plat-b@test.pf");
    expect(row.publicPath).toBe("/site/plat-b/plat-b");
    expect(ov.kpis.restaurants).toBe(2);
    expect(ov.kpis.active7).toBe(1);
    expect(ov.series).toHaveLength(30);
  });

  it("statut d'abonnement : essai prolongé, abonnement actif avec 12 mois d'engagement, suspension", async () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const t = await setOrganizationPlan(B.org.id, { plan: "TRIAL", trialEndsAt: "2026-10-20T09:00:00Z" }, admin, now);
    expect(t.trialEndsAt?.toISOString()).toBe("2026-10-20T09:00:00.000Z");
    const a = await setOrganizationPlan(B.org.id, { plan: "ACTIVE" }, admin, now);
    expect(a.plan).toBe("ACTIVE");
    expect(a.periodEndsAt?.toISOString().slice(0, 7)).toBe("2027-10");
    let ov = await platformOverview(now);
    expect(ov.rows.find((r) => r.id === B.org.id)!.status).toBe("ACTIVE");
    expect(ov.kpis.mrr).toBe(12_000);
    await setOrganizationPlan(B.org.id, { plan: "SUSPENDED" }, admin, now);
    ov = await platformOverview(now);
    expect(ov.rows.find((r) => r.id === B.org.id)!.status).toBe("SUSPENDED");
    const logs = await prisma.auditLog.findMany({ where: { organizationId: B.org.id, action: "platform.plan" } });
    expect(logs).toHaveLength(3);
    expect(logs[0].reason).toContain("admin@manaresto.com");
  });

  it("blocage : sessions fermées, connexion refusée, prise en main du support toujours possible", async () => {
    const { token } = await createSession({ userId: B.manager.id });
    expect(await findSessionByToken(token)).not.toBeNull();
    await setOrganizationBlocked(B.org.id, true, "impayé", admin);
    expect(await findSessionByToken(token)).toBeNull();
    await expect(loginWithPassword("manager-plat-b@test.pf", "password123")).rejects.toMatchObject({ status: 403, code: "ACCOUNT_BLOCKED" });
    const support = await createSession({ userId: B.owner.id, impersonatorId: A.owner.id });
    const s = await findSessionByToken(support.token);
    expect(s?.impersonatorId).toBe(A.owner.id);
    const ov = await platformOverview();
    expect(ov.rows.find((r) => r.id === B.org.id)).toMatchObject({ status: "BLOCKED", blockedReason: "impayé" });
    await setOrganizationBlocked(B.org.id, false, null, admin);
    const { token: t2 } = await createSession({ userId: B.manager.id });
    expect(await findSessionByToken(t2)).not.toBeNull();
  });

  it("prise en main : ne compte ni comme connexion du restaurateur", async () => {
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: B.server.id } })).lastLoginAt;
    await createSession({ userId: B.server.id, impersonatorId: A.owner.id });
    const after = (await prisma.user.findUniqueOrThrow({ where: { id: B.server.id } })).lastLoginAt;
    expect(after).toEqual(before);
  });

  it("e-mails : bienvenue et message libre journalisés, visibles dans la fiche", async () => {
    const n = sentMails.length;
    await sendWelcomeEmail(A.org.id);
    await sendManualEmail(A.org.id, "Besoin d'aide ?", "Ia ora na,\n\nNous pouvons vous aider.", A.owner.id);
    expect(sentMails.length).toBe(n + 2);
    expect(sentMails.at(-2)!.subject).toContain("Bienvenue sur ManaResto");
    expect(sentMails.at(-2)!.replyTo).toBe("contact@manaresto.com");
    expect(sentMails.at(-1)!.html).toContain("Nous pouvons vous aider.");
    const detail = await platformOrgDetail(A.org.id);
    expect(detail.emails.map((e) => e.kind)).toEqual(["MANUAL", "WELCOME"]);
    const ov = await platformOverview();
    expect(ov.rows.find((r) => r.id === A.org.id)).toMatchObject({ emailsTotal: 2, lastEmail: { kind: "MANUAL", status: "SENT" } });
  });

  it("alerte à l'équipe à chaque nouvelle inscription (destinataires réglables, démo ignorée)", async () => {
    delete process.env.PLATFORM_NOTIFY_EMAILS;
    expect(teamRecipients()).toBe("contact@manaresto.com");
    process.env.PLATFORM_NOTIFY_EMAILS = "Contact@manaresto.com,moi@icloud.com";
    expect(teamRecipients()).toBe("contact@manaresto.com, moi@icloud.com");
    const n = sentMails.length;
    await sendSignupAlert(A.org.id);
    const m = sentMails.at(-1)!;
    expect(sentMails.length).toBe(n + 1);
    expect(m.to).toBe("contact@manaresto.com, moi@icloud.com");
    expect(m.subject).toBe("Nouveau compte ManaResto — Resto plat-a (Owner plat-a)");
    expect(m.replyTo).toBe("owner-plat-a@test.pf");
    expect(m.html).toContain("/platform");
    delete process.env.PLATFORM_NOTIFY_EMAILS;
  });

  it("test d'envoi : e-mail aux destinataires des alertes, erreurs SMTP expliquées, clé API détectée", async () => {
    const n = sentMails.length;
    expect(await sendTestEmail()).toEqual({ to: "contact@manaresto.com" });
    expect(sentMails.length).toBe(n + 1);
    expect(sentMails.at(-1)!.subject).toBe("Test d'envoi ManaResto");
    expect(explainSmtpError("Invalid login: 535 5.7.8 Authentication failed")).toMatch(/clé SMTP \(xsmtpsib-…\), pas une clé API/);
    expect(explainSmtpError("Your SMTP account is not yet activated")).toMatch(/pas encore activé/);
    expect(explainSmtpError("550 5.7.1 Sender not authorized")).toMatch(/Expéditeurs/);
    expect(explainSmtpError("connect ETIMEDOUT 1.2.3.4:587")).toMatch(/port 587/);
    process.env.SMTP_PASS = "xkeysib-abc";
    expect(emailSettings().keyKind).toBe("API");
    process.env.SMTP_PASS = "xsmtpsib-abc";
    expect(emailSettings().keyKind).toBe("SMTP");
    delete process.env.SMTP_PASS;
  });

  it("relances : rappel à J-3 puis essai expiré, une seule fois chacun, comptes anciens et démo ignorés", async () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const soon = await makeTenant("plat-soon");
    const ended = await makeTenant("plat-ended");
    const old = await makeTenant("plat-old");
    const demo = await makeTenant("demo-mana-beach");
    await prisma.organization.update({ where: { id: soon.org.id }, data: { plan: "TRIAL", trialEndsAt: new Date(now.getTime() + 2 * DAY) } });
    await prisma.organization.update({ where: { id: ended.org.id }, data: { plan: "TRIAL", trialEndsAt: new Date(now.getTime() - 1 * DAY) } });
    await prisma.organization.update({ where: { id: old.org.id }, data: { plan: "TRIAL", trialEndsAt: new Date(now.getTime() - 30 * DAY) } });
    await prisma.organization.update({ where: { id: demo.org.id }, data: { plan: "TRIAL", trialEndsAt: new Date(now.getTime() + 1 * DAY) } });
    await prisma.organization.updateMany({ where: { id: { in: [A.org.id, B.org.id] } }, data: { plan: "ACTIVE" } });
    const n = sentMails.length;
    expect(await runLifecycleEmails(now)).toEqual({ reminders: 1, expired: 1 });
    expect(sentMails.slice(n).map((m) => m.to).sort()).toEqual(["owner-plat-ended@test.pf", "owner-plat-soon@test.pf"]);
    expect(sentMails.slice(n).find((m) => m.to === "owner-plat-soon@test.pf")!.subject).toBe("Votre essai ManaResto se termine dans 2 jours");
    expect(await runLifecycleEmails(now)).toEqual({ reminders: 0, expired: 0 });
    const ov = await platformOverview(now);
    expect(ov.rows.find((r) => r.id === demo.org.id)!.isDemo).toBe(true);
    expect(ov.kpis.restaurants).toBe(5); // démo exclue
  });
});

describe("E-mail de bienvenue", () => {
  it("propose d'essayer la démo préremplie (lien qui ouvre directement le compte d'exemple)", async () => {
    const { welcomeMail } = await import("@/server/services/platform-emails");
    const m = welcomeMail({ id: "o", name: "Chez Teva", trialEndsAt: null }, { id: "u", email: "teva@resto.pf", firstName: "Teva" });
    expect(m.html).toContain("Essayer la démo gratuitement");
    expect(m.html).toMatch(/\/login\?demo=1/);
    expect(m.text).toMatch(/Essayer la démo gratuitement : https?:\/\/\S+\/login\?demo=1/);
    // Exemple de page publique d'un restaurant
    expect(m.html).toContain("Voir un exemple de page restaurant");
    expect(m.text).toMatch(/Voir un exemple de page restaurant : https?:\/\/\S+\/site\/demo-mana-beach\/le-mana-beach/);
    expect(m.html).toContain("Ouvrir ManaResto");
    // Photo d'accueil en haut : liée par son adresse (jamais jointe), avec un texte de remplacement
    expect(m.html).toMatch(/<img src="https?:\/\/\S+\/email\/bienvenue\.jpg" alt="Ia ora na, bienvenue sur ManaResto !"/);
    expect(m.html.indexOf("bienvenue.jpg")).toBeLessThan(m.html.indexOf("Ia ora na Teva"));
    expect(m.html.length).toBeLessThan(20_000);
  });
});

describe("Aperçu du mail de bienvenue (console)", () => {
  it("envoie le vrai mail de bienvenue à l'adresse choisie, objet préfixé « [Aperçu] »", async () => {
    const { sendWelcomePreview } = await import("@/server/services/platform-emails");
    const n = sentMails.length;
    await expect(sendWelcomePreview("direction@exemple.pf", "Bruno")).resolves.toEqual({ to: "direction@exemple.pf" });
    expect(sentMails.length).toBe(n + 1);
    const m = sentMails.at(-1)!;
    expect(m.to).toBe("direction@exemple.pf");
    expect(m.subject).toBe("[Aperçu] Bienvenue sur ManaResto, Bruno !");
    expect(m.html).toContain("Essayer la démo gratuitement");
    expect(m.html).toContain("Voir un exemple de page restaurant");
  });
});
