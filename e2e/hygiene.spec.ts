import { test, expect, devices } from "@playwright/test";

test.use({ viewport: devices["iPhone 13"].viewport, userAgent: devices["iPhone 13"].userAgent, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

/** Hygiène & HACCP sur téléphone : relevé hors limites avec action corrective, nettoyage coché, préparation étiquetée, registre. */
test("hygiène : relevé, nettoyage, préparation et registre", async ({ page, context }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  await page.goto("/admin");
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await page.getByRole("button", { name: "Carte & stocks" }).last().click();
  await page.getByRole("link", { name: "Hygiène (HACCP)" }).last().click();
  await expect(page.getByRole("heading", { name: /Hygiène & HACCP/ })).toBeVisible();

  // Relevé hors limites : l'action corrective est exigée
  const card = page.getByTestId("equipment-card").filter({ hasText: "Frigo boissons" });
  await card.getByRole("button", { name: "Relever Frigo boissons" }).tap();
  await page.getByTestId("reading-value").fill("9,5");
  await expect(page.getByTestId("reading-out")).toBeVisible();
  await expect(page.getByTestId("reading-save")).toBeDisabled();
  await page.getByRole("button", { name: "Thermostat réglé" }).tap();
  await page.getByTestId("reading-save").tap();
  await expect(page.getByText("Relevé enregistré avec son action corrective")).toBeVisible();
  await expect(card).toContainText("9,5 °C");

  // Nettoyage coché (tâche créée pour le test : à toute heure, il en reste une à faire)
  const name = `Vitres ${Date.now().toString(36)}`;
  expect((await page.request.post("/api/hygiene/cleaning", { data: { name, area: "Salle", frequency: "DAILY" } })).status()).toBe(201);
  await page.reload();
  const task = page.getByTestId("cleaning-due").filter({ hasText: name });
  await task.getByRole("button", { name: `${name} fait` }).tap();
  await expect(page.getByText(`${name} : fait`)).toBeVisible();

  // Préparation maison : l'étiquette s'ouvre, prête à imprimer
  await page.getByRole("tab", { name: "Traçabilité" }).tap();
  await page.getByTestId("new-preparation").tap();
  const prep = `Sauce passion ${Date.now().toString(36)}`; // unique : le test peut être relancé sur la même base
  await page.getByLabel("Nom").fill(prep);
  const [label] = await Promise.all([context.waitForEvent("page"), page.getByTestId("trace-save").tap()]);
  await expect(label.locator("body")).toContainText(prep);
  await expect(label.locator("body")).toContainText("À consommer avant le");
  await label.close();
  await expect(page.getByTestId("trace-line").filter({ hasText: prep })).toBeVisible();
  await page.getByRole("button", { name: `${prep} utilisé` }).tap();
  await expect(page.getByTestId("trace-line").filter({ hasText: prep })).toContainText("Utilisé");

  // Registre : la non-conformité du jour et son action y figurent
  await page.getByTestId("open-register").tap();
  const [register] = await Promise.all([context.waitForEvent("page"), page.getByTestId("register-open").tap()]);
  await expect(register.locator("h1")).toHaveText("Registre d'hygiène");
  await expect(register.locator("body")).toContainText("Frigo boissons : 9,5 °C");
  await expect(register.locator("body")).toContainText("Thermostat réglé");
});
