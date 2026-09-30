import { test, expect } from "@playwright/test";

/** PWA : service worker versionné par build et bouton « Mettre à jour » quand une nouvelle version est prête. */
test("mise à jour de l'application : bandeau et bouton « Mettre à jour »", async ({ page }) => {
  const sw = await page.request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toContain("javascript");
  const body = await sw.text();
  expect(body).toContain('const VERSION = "mr-');
  expect(body).not.toContain("__BUILD__");

  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  await page.goto("/pos");
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15000 });
  await expect(page.getByText("Nouvelle version disponible")).toHaveCount(0);

  // Simule un nouveau déploiement : même script sous une autre URL → nouvelle version en attente
  await page.evaluate(() => navigator.serviceWorker.register("/sw.js?deploiement=2"));
  await expect(page.getByText("Nouvelle version disponible")).toBeVisible({ timeout: 15000 });
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Mettre à jour" }).click()]);
  await expect(page.locator("header").getByText("EN LIGNE")).toBeVisible();
  // La nouvelle version a pris le contrôle après le rechargement
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "")).toContain("deploiement=2");
});
