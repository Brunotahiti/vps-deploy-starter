import { test, expect, devices } from "@playwright/test";

test.use({ viewport: devices["iPhone 13"].viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

/** Téléphone : les menus de l'administration et de la caisse s'ouvrent du même côté (gauche) et la croix les ferme. */
test("menus du téléphone : même côté, fermeture par la croix", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });

  await page.goto("/admin");
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  const adminClose = page.getByRole("button", { name: "Fermer le menu" }).last();
  await expect(adminClose).toBeVisible();
  const adminMenu = (await adminClose.locator("xpath=ancestor::aside").boundingBox())!;
  expect(adminMenu.x).toBeLessThan(5);
  await adminClose.tap();
  await expect(adminClose).toBeHidden();

  await page.goto("/pos");
  await page.getByRole("button", { name: "Ouvrir le menu" }).tap();
  const posMenu = page.getByRole("dialog", { name: "Menu" });
  await expect(posMenu).toBeVisible();
  await page.waitForTimeout(400); // fin de l'animation d'ouverture
  expect((await posMenu.boundingBox())!.x).toBeLessThan(5);
  await posMenu.getByRole("button", { name: "Fermer le menu" }).tap();
  await expect(page.locator('[aria-hidden="true"] [role="dialog"][aria-label="Menu"]')).toHaveCount(1);
});
