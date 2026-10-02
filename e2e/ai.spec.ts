import { test, expect } from "@playwright/test";

/**
 * Assistant IA (restaurant exemple, toutes options) : prévisions façon Bison Futé, conseils de la semaine,
 * analyse qualité inspirée de l'ISO 9001 et commande proposée. Le serveur de test répond avec AI_TRANSPORT=fake.
 */
test("assistant IA : prévisions, conseils, analyse qualité, commande proposée", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  await page.goto("/admin");
  await page.getByRole("link", { name: "Assistant IA" }).first().click();
  await page.waitForURL(/\/admin\/ai$/);
  const days = page.getByTestId("forecast-days");
  await expect(days.locator("[data-level]")).toHaveCount(14);
  await page.getByTestId("week-advice").getByRole("button", { name: /Demander à l'IA|Mettre à jour/ }).click();
  await expect(page.getByTestId("week-advice")).toContainText("Rédigé le");
  await page.screenshot({ path: test.info().outputPath("ia-previsions.png"), fullPage: true });

  await page.getByRole("tab", { name: "Qualité" }).click();
  await page.getByTestId("run-quality").click();
  const report = page.getByTestId("quality-report");
  await expect(report).toContainText("sur 100");
  await expect(report).toContainText("8 · Réalisation des opérations");
  await expect(report).toContainText("Plan d'actions");
  await page.screenshot({ path: test.info().outputPath("ia-qualite.png"), fullPage: true });

  await page.getByRole("tab", { name: "Commande proposée" }).click();
  await expect(page.getByText(/Calculé sur votre consommation/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("ia-commande.png"), fullPage: true });

  // Les couleurs des prévisions apparaissent aussi sur la semaine des réservations
  await page.goto("/pos/reservations");
  await expect(page.getByTestId("forecast-chip").first()).toBeVisible();
});
