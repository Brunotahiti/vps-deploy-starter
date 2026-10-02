import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { createSession } from "@/server/auth/session";
import { cleanPath, deviceOf, isBot, recordSiteHit, referrerDomain, trafficStats, visitorOf } from "@/server/services/site-traffic";

let T: Awaited<ReturnType<typeof makeTenant>>;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1";

beforeAll(async () => {
  await resetDb();
  await prisma.siteEvent.deleteMany();
  T = await makeTenant("traffic");
});

describe("Fréquentation du site et des connexions", () => {
  it("nettoie les données : chemin, origine, appareil, robots", () => {
    expect(cleanPath("/index.html?utm_source=fb")).toBe("/");
    expect(cleanPath("/conditions.html#cgv")).toBe("/conditions");
    expect(cleanPath("mentions-legales")).toBe("/mentions-legales");
    expect(referrerDomain("https://www.google.com/search?q=caisse")).toBe("google.com");
    expect(referrerDomain("https://www.manaresto.com/conditions")).toBeNull(); // navigation interne
    expect(referrerDomain("pas une adresse")).toBeNull();
    expect(deviceOf(IPHONE)).toBe("mobile");
    expect(deviceOf(IPAD)).toBe("tablet");
    expect(deviceOf(MAC)).toBe("desktop");
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isBot(null)).toBe(true);
    expect(isBot(MAC)).toBe(false);
  });

  it("empreinte du visiteur : stable dans la journée, différente le lendemain, sans IP en clair", () => {
    const a = visitorOf("1.2.3.4", MAC, new Date("2026-10-10T18:00:00Z"));
    expect(a).toHaveLength(16);
    expect(a).not.toContain("1.2.3.4");
    expect(visitorOf("1.2.3.4", MAC, new Date("2026-10-10T20:00:00Z"))).toBe(a);
    expect(visitorOf("1.2.3.4", MAC, new Date("2026-10-11T18:00:00Z"))).not.toBe(a);
  });

  it("compte les visites, pages, clics, connexions et inscriptions à l'heure de Tahiti", async () => {
    // Samedi 10 octobre 2026, 8 h 15 à Tahiti (18 h 15 UTC) : un visiteur sur iPhone venant de Google lit deux pages
    const t1 = new Date("2026-10-10T18:15:00Z");
    expect(await recordSiteHit({ type: "view", path: "/index.html", referrer: "https://www.google.com/" , utmSource: "Facebook" }, { ip: "1.1.1.1", ua: IPHONE }, t1)).toBe(true);
    await recordSiteHit({ type: "view", path: "/conditions", referrer: "https://www.manaresto.com/" }, { ip: "1.1.1.1", ua: IPHONE }, new Date(t1.getTime() + 60_000));
    await recordSiteHit({ type: "click", name: "cta_trial", path: "/" }, { ip: "1.1.1.1", ua: IPHONE }, new Date(t1.getTime() + 90_000));
    // Un autre visiteur sur ordinateur, et un robot (ignoré)
    await recordSiteHit({ type: "view", path: "/" }, { ip: "2.2.2.2", ua: MAC }, t1);
    expect(await recordSiteHit({ type: "view", path: "/" }, { ip: "3.3.3.3", ua: "Googlebot/2.1" }, t1)).toBe(false);
    // Clic sans nom : ignoré
    expect(await recordSiteHit({ type: "click" }, { ip: "2.2.2.2", ua: MAC }, t1)).toBe(false);
    // Hier (vendredi) : le premier visiteur revient → compté comme une autre visite
    await recordSiteHit({ type: "view", path: "/" }, { ip: "1.1.1.1", ua: IPHONE }, new Date("2026-10-09T18:15:00Z"));

    // Connexions : mot de passe (iPad) et PIN ; une prise en main par le support n'est pas comptée
    await createSession({ userId: T.owner.id, establishmentId: T.est.id, userAgent: IPAD, via: "password" });
    await createSession({ userId: T.server.id, establishmentId: T.est.id, via: "pin" });
    await createSession({ userId: T.owner.id, impersonatorId: T.manager.id, via: "password" });
    await prisma.siteEvent.updateMany({ where: { kind: "login" }, data: { at: new Date("2026-10-10T19:05:00Z") } }); // 9 h 05 à Tahiti

    const s = await trafficStats(7, new Date("2026-10-10T20:00:00Z"));
    expect(s.today).toBe("2026-10-10");
    expect(s.series.days).toHaveLength(7);
    expect(s.totals).toMatchObject({ visits: 3, views: 4, clicks: 1, logins: 2, activeUsers: 2, signups: 0 });
    expect(s.series.visits.slice(-2)).toEqual([1, 2]);
    // Heure locale : samedi (index 5) à 8 h
    expect(s.viewGrid[5][8]).toBe(3);
    expect(s.viewGrid[4][8]).toBe(1);
    expect(s.loginHours[9]).toBe(2);
    expect(s.pages[0]).toEqual({ k: "/", n: 3 });
    expect(s.referrers).toEqual(expect.arrayContaining([{ k: "google.com", n: 1 }, { k: null, n: 3 }]));
    expect(s.devices).toEqual(expect.arrayContaining([{ k: "mobile", n: 3 }, { k: "desktop", n: 1 }]));
    expect(s.utm).toEqual(expect.arrayContaining([{ k: "facebook", n: 1 }]));
    expect(s.clicks).toEqual([{ k: "cta_trial", n: 1 }]);
    expect(s.loginMethods).toEqual(expect.arrayContaining([{ k: "password", n: 1 }, { k: "pin", n: 1 }]));
    expect(s.topOrgs[0]).toMatchObject({ id: T.org.id, n: 2, users: 2 });
    expect(s.recent[0].organization).toBe(T.org.name);
    expect(s.recent.every((r) => r.kind === "login")).toBe(true);
    // Rien n'est conservé de l'adresse IP ni du navigateur
    const raw = await prisma.siteEvent.findMany();
    expect(JSON.stringify(raw)).not.toMatch(/1\.1\.1\.1|iPhone OS/);
  });

  it("période précédente, temps réel et ménage au-delà de 13 mois", async () => {
    const now = new Date("2026-10-10T20:00:00Z");
    await prisma.siteEvent.create({ data: { kind: "view", path: "/", visitor: "ancien", at: new Date("2026-10-01T20:00:00Z") } });
    await prisma.siteEvent.create({ data: { kind: "view", path: "/", visitor: "perime", at: new Date("2025-08-01T00:00:00Z") } });
    await recordSiteHit({ type: "view", path: "/" }, { ip: "4.4.4.4", ua: MAC }, new Date(now.getTime() - 5 * 60_000));
    const s = await trafficStats(7, now);
    expect(s.previous.visits).toBe(1);
    expect(s.live).toEqual({ visitors: 1, views: 1, logins: 0 });
    expect(await prisma.siteEvent.count({ where: { visitor: "perime" } })).toBe(0);
  });

  it("inscription et visite de la démo sont comptées à part des connexions", async () => {
    await prisma.siteEvent.deleteMany();
    await createSession({ userId: T.owner.id, via: "signup" });
    await createSession({ userId: T.manager.id, via: "demo" });
    const s = await trafficStats(30);
    expect(s.totals).toMatchObject({ logins: 0, signups: 1, demos: 1 });
    expect(s.recent.map((r) => r.kind)).toEqual(["signup"]);
  });
});
