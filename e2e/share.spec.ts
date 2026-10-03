import { test, expect } from "@playwright/test";

/** Adresse de partage du site : carte « Partager mon site », page à l'adresse courte, aperçu du lien. */
test("partager le site : belle adresse, aperçu du lien, page du restaurant", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  await page.goto("/admin/digital");
  const card = page.getByTestId("share-site");
  await expect(card).toBeVisible();
  const url = (await page.getByTestId("share-url").getAttribute("href"))!;
  expect(url).toMatch(/\/le-mana-beach$/);
  await expect(card.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=.*le-mana-beach/);
  await expect(card.getByRole("link", { name: /Facebook/ })).toHaveAttribute("href", /facebook\.com\/sharer/);

  // Aperçu du lien : image JPEG 1200 × 630 générée pour le restaurant
  const img = await page.request.get("/api/public/share-card/le-mana-beach");
  expect(img.ok()).toBeTruthy();
  expect(img.headers()["content-type"]).toBe("image/jpeg");
  expect((await img.body()).length).toBeLessThan(400_000);
  expect((await page.request.get("/api/public/share-card/inconnu")).status()).toBe(404);
  // QR code de l'adresse
  expect((await page.request.get("/api/digital/share/qr")).headers()["content-type"]).toBe("image/png");

  // Changer l'adresse : vérifications pendant la saisie (le restaurant exemple ne peut pas l'enregistrer)
  await page.getByTestId("share-edit").click();
  await page.getByTestId("share-input").fill("ab");
  await expect(page.getByTestId("share-status")).toContainText("Entre 3 et 40");
  await page.getByTestId("share-input").fill("admin");
  await expect(page.getByTestId("share-status")).toContainText("réservée");
  await page.getByTestId("share-input").fill("mana-beach-plage");
  await expect(page.getByTestId("share-status")).toHaveText("Disponible");
  await page.keyboard.press("Escape");

  // La page du restaurant à l'adresse courte, avec son aperçu et son adresse officielle
  await page.goto("/r/le-mana-beach");
  await expect(page.getByRole("heading", { name: "Le Mana Beach", level: 1 })).toBeVisible();
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/api\/public\/share-card\/le-mana-beach$/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/le-mana-beach$/);
  expect((await page.request.get("/r/restaurant-inconnu")).status()).toBe(404);
});
