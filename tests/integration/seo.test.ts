import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { DEMO_ORG_SLUG } from "@/lib/platform";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

const previousUrl = process.env.PUBLIC_URL;
afterAll(() => { if (previousUrl === undefined) delete process.env.PUBLIC_URL; else process.env.PUBLIC_URL = previousUrl; });

beforeAll(async () => {
  await resetDb();
  process.env.PUBLIC_URL = "https://app.manaresto.com/";
  await makeTenant("seo-ok");
  await makeTenant("seo-base", { options: ["stock"] }); // sans l'option Digital : pas de site public
  const off = await makeTenant("seo-off");
  await prisma.establishment.update({ where: { id: off.est.id }, data: { settings: { site: { enabled: false } } } });
  const blocked = await makeTenant("seo-bloque");
  await prisma.organization.update({ where: { id: blocked.org.id }, data: { blockedAt: new Date() } });
  await makeTenant(DEMO_ORG_SLUG);
});

describe("Référencement de l'application", () => {
  it("le sitemap ne liste que les sites publics réels des restaurants", async () => {
    const urls = (await sitemap()).map((u) => u.url);
    expect(urls).toEqual(["https://app.manaresto.com/site/seo-ok/seo-ok"]);
  });

  it("robots.txt ouvre les pages publiques et ferme l'application", () => {
    const r = robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.allow).toEqual(expect.arrayContaining(["/site/", "/commander/", "/reserver/"]));
    expect(rule.disallow).toEqual(expect.arrayContaining(["/api/", "/admin", "/pos", "/platform", "/demo", "/commande$"]));
    expect(r.sitemap).toBe("https://app.manaresto.com/sitemap.xml");
  });
});
