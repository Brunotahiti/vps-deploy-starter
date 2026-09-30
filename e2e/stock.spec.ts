import { test, expect, type Page } from "@playwright/test";

const field = (page: Page, label: string) => page.locator(`label:has(span:text-is("${label}"))`).locator("input, select, textarea").first();

/** Phase 4 : ingrédient, perte tracée, alerte de seuil, rapport. */
test("stock : créer un ingrédient, enregistrer une perte, voir l'alerte", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("demo@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  const name = `Citron vert E2E ${Date.now().toString().slice(-5)}`;
  await page.goto("/admin/stock");
  await page.getByRole("button", { name: "Nouvel ingrédient" }).click();
  await field(page, "Nom").fill(name);
  await field(page, "Seuil d'alerte").fill("5");
  await field(page, "Coût moyen par unité (F)").fill("50");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/Ingrédient enregistré/)).toBeVisible();
  const row = page.locator("tr", { hasText: name });
  await expect(row).toBeVisible();
  // Achat direct (+10) puis perte (−7) → sous le seuil
  await row.getByRole("button", { name: "Perte / ajust." }).click();
  await page.getByRole("button", { name: "Achat" }).click();
  await field(page, "Quantité (pce)").fill("10");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/Mouvement enregistré/)).toBeVisible();
  await row.getByRole("button", { name: "Perte / ajust." }).click();
  await field(page, "Quantité (pce)").fill("7");
  await field(page, "Motif (obligatoire)").fill("Périmé");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(/Mouvement enregistré/).last()).toBeVisible();
  await expect(row).toContainText("3");
  const alerts = await (await page.request.get("/api/stock/alerts")).json();
  expect(alerts.data.ingredients.some((a: { name: string }) => a.name === name)).toBe(true);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Tahiti" }).format(new Date()); // jour local de l'établissement
  const report = await (await page.request.get(`/api/stock/report?from=${day}&to=${day}`)).json();
  expect(report.data.losses).toBeGreaterThanOrEqual(350); // 7 × 50 F
  expect(report.data.topLosses.some((l: { name: string; value: number }) => l.name === name && l.value === 350)).toBe(true);
  const moves = await (await page.request.get(`/api/stock/movements?kind=LOSS&take=50`)).json();
  expect(JSON.stringify(moves.data)).toContain("Périmé");
});
