import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { restaurantSite, siteSettings, DEFAULT_SITE } from "@/server/services/public";
import { todayKey } from "@/components/public/restaurant-site";

let T: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("site");
});

describe("Phase 10 — site du restaurant", () => {
  it("le site est publié par défaut avec les coordonnées, le menu et les canaux", async () => {
    const d = await restaurantSite("site", "site");
    expect(d.establishment.name).toBe(T.est.name);
    expect(d.site).toEqual(DEFAULT_SITE);
    expect(d.online.enabled).toBe(false);
    expect(d.menu!.products.some((p) => p.id === T.burger.id)).toBe(true);
    expect(d.menu!.products[0]).not.toHaveProperty("costPrice");
  });
  it("les réglages sont fusionnés avec les valeurs par défaut ; menu masquable ; site dépubliable", async () => {
    await prisma.establishment.update({ where: { id: T.est.id }, data: { settings: { site: { tagline: "Vue lagon", showMenu: false } } } });
    const s = await siteSettings(T.est.id);
    expect(s).toMatchObject({ tagline: "Vue lagon", showMenu: false, enabled: true, photos: [] });
    expect((await restaurantSite("site", "site")).menu).toBeNull();
    await prisma.establishment.update({ where: { id: T.est.id }, data: { settings: { site: { enabled: false } } } });
    await expect(restaurantSite("site", "site")).rejects.toMatchObject({ status: 404 });
    await expect(restaurantSite("site", "inconnu")).rejects.toMatchObject({ status: 404 });
  });
  it("le jour courant est calculé dans le fuseau du restaurant", () => {
    // 2026-10-01T09:30Z = mercredi 30 septembre 23 h 30 à Tahiti (UTC-10), mais déjà jeudi à Paris
    expect(todayKey("Pacific/Tahiti", new Date("2026-10-01T09:30:00Z"))).toBe("wed");
    expect(todayKey("Europe/Paris", new Date("2026-10-01T09:30:00Z"))).toBe("thu");
    expect(todayKey("Pacific/Tahiti", new Date("2026-10-01T22:00:00Z"))).toBe("thu");
  });
});
