import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { restaurantSite, siteSettings, DEFAULT_SITE } from "@/server/services/public";
import { openStatus, todayKey } from "@/components/public/restaurant-site";

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

  it("ouvert maintenant, ou prochaine ouverture, dans le fuseau du restaurant", () => {
    const H = { mon: ["11:00-14:30", "18:00-22:00"], tue: ["11:00-14:30", "18:00-01:00"], wed: [] as string[], thu: ["11:00-14:30"], fri: ["11:00-14:30"], sat: [] as string[], sun: [] as string[] };
    const at = (iso: string) => openStatus(H, "Pacific/Tahiti", new Date(iso));
    // Lundi 28 septembre 2026, 12 h à Tahiti (22 h UTC) : ouvert jusqu'à 14:30
    expect(at("2026-09-28T22:00:00Z")).toEqual({ open: true, until: "14:30" });
    // Lundi 15 h : fermé, rouvre à 18:00 le jour même
    expect(at("2026-09-29T01:00:00Z")).toEqual({ open: false, next: { day: "mon", at: "18:00", inDays: 0 } });
    // Mardi 23 h 30 : le créneau 18:00-01:00 déborde après minuit
    expect(at("2026-09-30T09:30:00Z")).toEqual({ open: true, until: "01:00" });
    // Mercredi 0 h 30 : encore ouvert grâce au créneau de la veille
    expect(at("2026-09-30T10:30:00Z")).toEqual({ open: true, until: "01:00" });
    // Mercredi 12 h (fermé toute la journée) : prochaine ouverture jeudi 11:00
    expect(at("2026-09-30T22:00:00Z")).toEqual({ open: false, next: { day: "thu", at: "11:00", inDays: 1 } });
    // Vendredi 20 h : rouvre lundi
    expect(at("2026-10-03T06:00:00Z")).toEqual({ open: false, next: { day: "mon", at: "11:00", inDays: 3 } });
    expect(openStatus({}, "Pacific/Tahiti")).toEqual({ open: false, next: null });
  });
});
