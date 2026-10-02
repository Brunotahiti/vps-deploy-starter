import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { setProductAvailability } from "@/server/services/catalog";
import { deleteScreen, listScreens, regenerateScreenToken, screenDisplay, upsertScreen } from "@/server/services/screens";

let T: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("ecrans");
});

describe("Écrans en salle", () => {
  it("toute la carte par défaut : catégories et produits, prix, adresse secrète, « vu à l'instant »", async () => {
    const s = await upsertScreen(T.managerActor, { name: "Comptoir" });
    expect(s.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    const d = await screenDisplay(s.token);
    expect(d.name).toBe(T.est.name);
    const items = d.categories.flatMap((c) => c.products.map((p) => p.name));
    expect(items).toEqual(expect.arrayContaining(["Burger", "Bière", "Eau", "Salade"]));
    expect(d.categories[0].products.find((p) => p.name === "Burger")).toMatchObject({ price: 2100, soldOut: false });
    expect((await prisma.screen.findUniqueOrThrow({ where: { id: s.id } })).lastSeenAt).not.toBeNull();
  });

  it("plat épuisé : barré « Épuisé », ou masqué selon le réglage ; mise en avant", async () => {
    await setProductAvailability(T.managerActor, T.biere.id, false);
    const [s] = await listScreens(T.est.id);
    let d = await screenDisplay(s.token);
    expect(d.categories.flatMap((c) => c.products).find((p) => p.name === "Bière")!.soldOut).toBe(true);
    await upsertScreen(T.managerActor, { id: s.id, name: "Comptoir", hideSoldOut: true, headline: "Plat du jour", headlineText: "Poisson cru au lait de coco", headlinePrice: 1800, showPrices: false });
    d = await screenDisplay(s.token);
    expect(d.categories.flatMap((c) => c.products).some((p) => p.name === "Bière")).toBe(false);
    expect(d.headline).toEqual({ title: "Plat du jour", text: "Poisson cru au lait de coco", price: 1800 });
    expect(d.showPrices).toBe(false);
    await setProductAvailability(T.managerActor, T.biere.id, true);
  });

  it("catégories choisies, dans l'ordre choisi ; catégorie d'un autre restaurant refusée", async () => {
    const other = await makeTenant("ecrans-autre");
    await expect(upsertScreen(T.managerActor, { name: "Terrasse", categoryIds: [other.cat.id] })).rejects.toMatchObject({ code: "BAD_CATEGORY" });
    const s = await upsertScreen(T.managerActor, { name: "Terrasse", categoryIds: [T.cat.id] });
    const d = await screenDisplay(s.token);
    expect(d.categories.map((c) => c.id)).toEqual([T.cat.id]);
  });

  it("nouvelle adresse : l'ancienne ne fonctionne plus ; écran désactivé ou supprimé : introuvable ; option retirée : refusé", async () => {
    const s = await upsertScreen(T.managerActor, { name: "Vitrine" });
    const fresh = await regenerateScreenToken(T.managerActor, s.id);
    await expect(screenDisplay(s.token)).rejects.toMatchObject({ status: 404 });
    await screenDisplay(fresh.token);
    await upsertScreen(T.managerActor, { id: s.id, name: "Vitrine", isActive: false });
    await expect(screenDisplay(fresh.token)).rejects.toMatchObject({ status: 404 });
    await upsertScreen(T.managerActor, { id: s.id, name: "Vitrine", isActive: true });
    await prisma.organization.update({ where: { id: T.org.id }, data: { options: ["stock"] } });
    await expect(screenDisplay(fresh.token)).rejects.toMatchObject({ code: "OPTION_REQUIRED" });
    await prisma.organization.update({ where: { id: T.org.id }, data: { options: ["screens"] } });
    await deleteScreen(T.managerActor, s.id);
    await expect(screenDisplay(fresh.token)).rejects.toMatchObject({ status: 404 });
  });
});
