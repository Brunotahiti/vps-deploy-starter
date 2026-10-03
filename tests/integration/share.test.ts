import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { createEstablishment } from "@/server/services/establishments";
import { ensureShareSlug, resolveShareSlug, setShareSlug, shareSlugAvailability } from "@/server/services/share";
import { DEMO_ORG_SLUG } from "@/lib/platform";
import { shareSlugError } from "@/lib/share";
import { fetchPublicImage } from "@/server/net/fetch-image";

let T: Awaited<ReturnType<typeof makeTenant>>;
let U: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("partage");
  U = await makeTenant("partage-voisin");
});

describe("adresse de partage du site", () => {
  it("attribuée d'après le nom, unique sur toute la plateforme", async () => {
    await prisma.establishment.update({ where: { id: T.est.id }, data: { name: "Chez Hina" } });
    await prisma.establishment.update({ where: { id: U.est.id }, data: { name: "Chez Hina" } });
    expect(await ensureShareSlug(T.est.id)).toBe("chez-hina");
    expect(await ensureShareSlug(U.est.id)).toBe("chez-hina-2");
    expect(await ensureShareSlug(T.est.id)).toBe("chez-hina"); // déjà attribuée : inchangée
    const third = await createEstablishment(T.org.id, T.owner.id, { name: "Chez Hina" });
    expect(third.shareSlug).toBe("chez-hina-3");
    expect(await resolveShareSlug("CHEZ-HINA")).toMatchObject({ slug: T.est.slug, organization: { slug: T.org.slug } });
    expect(await resolveShareSlug("inconnu")).toBeNull();
    expect(await resolveShareSlug("../admin")).toBeNull();
  });

  it("choisie par le restaurant : format, mots réservés, déjà prise", async () => {
    expect(await shareSlugAvailability(T.est.id, "chez-hina-2")).toMatchObject({ available: false, reason: expect.stringMatching(/Déjà prise/) });
    expect(await shareSlugAvailability(T.est.id, "chez-hina")).toMatchObject({ available: true }); // la sienne
    expect(await shareSlugAvailability(T.est.id, "admin")).toMatchObject({ available: false });
    await expect(setShareSlug(T.managerActor, "Chez Hina!")).rejects.toMatchObject({ code: "BAD_SHARE_SLUG" });
    await expect(setShareSlug(T.managerActor, "pos")).rejects.toMatchObject({ code: "BAD_SHARE_SLUG" });
    await expect(setShareSlug(T.managerActor, "chez-hina-2")).rejects.toMatchObject({ code: "SHARE_SLUG_TAKEN" });
    expect(await setShareSlug(T.managerActor, "  Hina-Punaauia ")).toMatchObject({ shareSlug: "hina-punaauia", url: expect.stringMatching(/\/hina-punaauia$/) });
    expect(await resolveShareSlug("chez-hina")).toBeNull(); // l'ancienne adresse est libérée
    expect(await prisma.auditLog.count({ where: { action: "establishment.share_slug", entityId: T.est.id } })).toBe(1);
  });

  it("restaurant exemple : adresse non modifiable", async () => {
    await prisma.organization.update({ where: { id: U.org.id }, data: { slug: DEMO_ORG_SLUG } });
    await expect(setShareSlug(U.managerActor, "autre-adresse")).rejects.toMatchObject({ code: "DEMO_LOCKED" });
  });

  it("nom long déjà pris : jamais de double tiret (adresse reconnue par manaresto.com)", async () => {
    const name = "Restaurant Chez Mamie Hina de Papeete et Moorea";
    const a = await createEstablishment(T.org.id, T.owner.id, { name });
    const b = await createEstablishment(U.org.id, U.owner.id, { name });
    for (const e of [a, b]) expect(shareSlugError(e.shareSlug ?? "")).toBeNull();
    expect(b.shareSlug).not.toContain("--");
  });

  it("deux restaurants au même nom créés au même instant : les deux obtiennent une adresse", async () => {
    const [a, b] = await Promise.all([createEstablishment(T.org.id, T.owner.id, { name: "Snack Teva" }), createEstablishment(U.org.id, U.owner.id, { name: "Snack Teva" })]);
    expect(a.shareSlug).toBeTruthy();
    expect(b.shareSlug).toBeTruthy();
    expect(a.shareSlug).not.toBe(b.shareSlug);
  });
});

describe("image d'aperçu : photo externe sans jamais viser le réseau interne", () => {
  it("adresses internes, locales ou non https refusées", async () => {
    for (const url of ["https://127.0.0.1/x.jpg", "https://localhost/x.jpg", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/a.png", "http://exemple.pf/a.jpg", "https://manaresto:3000/api/health", "https://[::1]/a.png"]) {
      expect(await fetchPublicImage(url, { timeoutMs: 1500 })).toBeNull();
    }
  });
});
