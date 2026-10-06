import { test, expect } from "@playwright/test";
import sharp from "sharp";

/**
 * Site du restaurant : couverture, logo et photos envoyés depuis l'appareil (plus besoin d'une adresse web), réduits
 * avant l'envoi, enregistrés aussitôt et visibles sur la page publique.
 */
const photo = (width: number, height: number, color: string, format: "jpeg" | "png") =>
  sharp({ create: { width, height, channels: 3, background: color } })[format]().toBuffer();

test("site du restaurant : envoyer couverture, logo et photos depuis le téléphone ou l'ordinateur", async ({ page, browser }) => {
  const stamp = Date.now();
  const res = await page.request.post("/api/auth/signup", { data: { organizationName: `Photos ${stamp}`, establishmentName: "Chez Moana", firstName: "Moana", lastName: "Photo", email: `photos${stamp}@test.pf`, password: "motdepasse1" } });
  expect(res.ok()).toBeTruthy();
  const me = (await (await page.request.get("/api/auth/me")).json()).data;

  // L'équipe ManaResto active l'option Digital (site du restaurant)
  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await admin.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  const adminMe = (await (await admin.request.get("/api/auth/me")).json()).data;
  test.skip(!adminMe.platformAdmin, "PLATFORM_ADMIN_EMAILS ne contient pas demo@manaresto.pf sur ce serveur");
  expect((await admin.request.patch(`/api/platform/orgs/${me.organizationId}/options`, { data: { options: ["digital"] } })).ok()).toBeTruthy();
  await ctx.close();

  await page.goto("/admin/digital");
  // Couverture : une grande photo de téléphone (2400 px), réduite à 1920 px au plus
  await page.getByTestId("site-cover").locator("input[type=file]").setInputFiles({ name: "salle.jpg", mimeType: "image/jpeg", buffer: await photo(2400, 1600, "#14aaa3", "jpeg") });
  await expect(page.getByTestId("site-cover").locator("img")).toHaveAttribute("src", /^\/api\/uploads\//);
  await page.getByTestId("site-logo").locator("input[type=file]").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: await photo(900, 900, "#f97c3c", "png") });
  await expect(page.getByTestId("site-logo").locator("img")).toHaveAttribute("src", /^\/api\/uploads\//);
  // Galerie : deux photos choisies d'un coup
  await page.getByTestId("gallery-input").setInputFiles([
    { name: "plat.jpg", mimeType: "image/jpeg", buffer: await photo(1200, 900, "#0f6e6c", "jpeg") },
    { name: "vue.jpg", mimeType: "image/jpeg", buffer: await photo(1200, 900, "#e5602a", "jpeg") },
  ]);
  await expect(page.getByTestId("gallery-photo")).toHaveCount(2);

  // Enregistré sans appuyer sur « Enregistrer »
  await expect.poll(async () => { const s = (await (await page.request.get("/api/digital/settings")).json()).data.site; return [s.coverUrl.startsWith("/api/uploads/"), s.logoUrl.startsWith("/api/uploads/"), s.photos.length]; }).toEqual([true, true, 2]);
  const settings = (await (await page.request.get("/api/digital/settings")).json()).data;
  const cover = await sharp(await (await page.request.get(settings.site.coverUrl)).body()).metadata();
  expect(Math.max(cover.width!, cover.height!)).toBeLessThanOrEqual(1920);

  // Visibles sur la page publique du restaurant
  await page.goto(settings.urls.site);
  await expect(page.locator(`img[src*="${settings.site.coverUrl.split("/").pop()}"]`).first()).toBeAttached();
  await expect(page.locator(`img[src*="${settings.site.photos[0].split("/").pop()}"]`).first()).toBeAttached();

  // Retirer une photo : enregistré aussitôt
  await page.goto("/admin/digital");
  await page.getByTestId("gallery-photo").first().getByRole("button", { name: "Retirer la photo" }).click();
  await expect(page.getByTestId("gallery-photo")).toHaveCount(1);
  await expect.poll(async () => (await (await page.request.get("/api/digital/settings")).json()).data.site.photos.length).toBe(1);
});
