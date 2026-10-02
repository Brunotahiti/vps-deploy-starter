import { test, expect } from "@playwright/test";

/**
 * Programme de base + options : un snack qui s'inscrit a un programme épuré, demande l'option Stock depuis
 * Gestion → Options, l'équipe ManaResto l'active depuis la console, et l'option apparaît chez lui.
 */
test("snack : programme de base épuré, demande d'option, activation par la console", async ({ page, browser }) => {
  const stamp = Date.now();
  // Inscription par le formulaire, en choisissant « Snack »
  await page.goto("/signup");
  await page.getByRole("radio", { name: /Snack, roulotte/ }).click();
  await page.getByLabel("Entreprise").fill(`Roulotte ${stamp}`);
  await page.getByLabel("Nom du restaurant").fill(`Snack du port ${stamp}`);
  await page.getByLabel("Prénom").fill("Hina");
  await page.getByLabel("Nom", { exact: true }).fill("Test");
  await page.getByLabel("Email").fill(`snack${stamp}@test.pf`);
  await page.getByLabel(/Mot de passe/).fill("motdepasse1");
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL(/\/onboarding/);
  // Mise en route sans « Salles » ni « Tables »
  await expect(page.getByText(/Étape 1 \/ 13/)).toBeVisible();
  await page.getByRole("button", { name: "Passer l'assistant" }).click();
  await page.waitForURL(/\/admin$/);

  // Menu épuré : ni stock, ni personnel, ni QR, ni intégrations, ni plan de salle (snack)
  const menu = page.getByRole("navigation", { name: "Menu" }).first();
  await expect(menu.getByRole("link", { name: "Options" })).toBeVisible();
  // Une rubrique ouverte à la fois : chacune est vérifiée à son tour
  const groups: [string, string[], string[]][] = [
    ["Ventes", ["Commandes", "Caisse"], ["Statistiques", "Rapports & exports"]],
    ["Carte & stocks", ["Catalogue"], ["Stocks & achats"]],
    ["Équipe", ["Accès & PIN"], ["Personnel & planning"]],
    ["Réglages", ["Paramètres", "Imprimantes & tiroir"], ["Intégrations", "Établissements", "Multi-sites", "Journal d'audit"]],
  ];
  for (const [group, shown, hidden] of groups) {
    await menu.getByRole("button", { name: group }).click();
    for (const name of shown) await expect(menu.getByRole("link", { name }), name).toBeVisible();
    for (const name of hidden) await expect(menu.getByRole("link", { name }), name).toHaveCount(0);
  }
  // « Salle & clients » : ni plan de salle (snack), ni réservations, clients, QR (option Digital) : rubrique absente
  await expect(menu.getByRole("button", { name: "Salle & clients" })).toHaveCount(0);
  // Le serveur refuse aussi ces fonctions
  expect((await page.request.get("/api/stock/ingredients")).status()).toBe(403);
  expect((await page.request.get("/api/digital/settings")).status()).toBe(403);
  expect((await page.request.get("/api/stats?from=2026-01-01&to=2026-01-31")).status()).toBe(403);
  expect((await page.request.get("/api/reports/export?type=period&format=csv&from=2026-01-01&to=2026-01-31")).status()).toBe(403);
  // Portail « Comptoir » pour un snack, pas de bouton « À faire »
  await expect(page.getByTestId("portal-dock").getByRole("link", { name: "Comptoir" })).toBeVisible();
  await page.goto("/pos");
  await expect(page.getByRole("button", { name: /À faire/ })).toHaveCount(0);
  // Sans l'option Continuité de service : une coupure d'internet est annoncée, rien n'est mis en file
  await page.context().setOffline(true);
  await expect(page.getByTestId("offline-locked")).toContainText("Continuité de service");
  await page.context().setOffline(false);
  await expect(page.getByTestId("offline-locked")).toHaveCount(0);

  // Aide sur place
  await page.goto("/admin/options");
  await page.getByRole("button", { name: "Aide sur cette page" }).click();
  await expect(page.getByTestId("page-help")).toContainText("Débloquez une option");

  // Demande de l'option Stock
  const stock = page.getByTestId("option-stock");
  await expect(stock).toContainText("Stock et recettes");
  await stock.getByRole("button", { name: "Débloquer" }).click();
  await expect(stock).toContainText("Demande envoyée");
  await page.screenshot({ path: test.info().outputPath("options.png"), fullPage: true });

  // Console ManaResto : la demande apparaît, l'option est activée depuis la fiche du restaurant
  const ctx = await browser.newContext();
  const admin = await ctx.newPage();
  await admin.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  await admin.goto("/platform");
  const panel = admin.getByTestId("platform-options");
  const row = panel.getByRole("listitem").filter({ hasText: `Roulotte ${stamp}` });
  await expect(row).toContainText("Stock et recettes");
  await row.getByRole("button", { name: "Ouvrir la fiche" }).click();
  await admin.getByTestId("org-options").getByRole("switch", { name: "Option Stock et recettes" }).click();
  await expect(panel.getByRole("listitem").filter({ hasText: `Roulotte ${stamp}` })).toHaveCount(0);
  await ctx.close();

  // Chez le restaurateur : l'option est active et son menu apparaît
  await page.reload();
  await expect(page.getByTestId("option-stock")).toContainText("Active");
  expect((await page.request.get("/api/stock/ingredients")).status()).toBe(200);
  await page.goto("/admin/stock");
  await expect(page.getByText(/Une erreur est survenue/)).toHaveCount(0);
});

/** Téléphone : le mot « Menu » sous l'icône du menu. */
test("le bouton du menu porte le mot « Menu »", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  for (const path of ["/admin", "/pos"]) {
    await page.goto(path);
    await expect(page.getByRole("button", { name: "Ouvrir le menu" }).locator("visible=true")).toContainText("Menu");
  }
  await ctx.close();
});
