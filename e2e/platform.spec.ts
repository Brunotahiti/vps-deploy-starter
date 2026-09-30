import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Console plateforme : nécessite PLATFORM_ADMIN_EMAILS=demo@manaresto.pf sur le serveur de test (sinon ignoré).
 * Un restaurant s'inscrit, l'administrateur le voit, prend la main, revient, active l'abonnement puis bloque le compte.
 */
test("console : voir un nouvel inscrit, prendre la main, revenir, activer puis bloquer", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());

  // Un restaurateur s'inscrit (contexte séparé)
  const stamp = Date.now();
  const email = `tiare${stamp}@test.pf`;
  const other = await pwRequest.newContext({ baseURL });
  const res = await other.post("/api/auth/signup", { data: { organizationName: `Snack Tiare ${stamp}`, establishmentName: "Snack Tiare", firstName: "Tiare", lastName: `Console${stamp}`, email, password: "motdepasse1" } });
  expect(res.ok()).toBeTruthy();
  await other.post("/api/auth/heartbeat");

  // L'administrateur se connecte
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("demo@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(admin|pos)/);
  const me = await (await page.request.get("/api/auth/me")).json();
  test.skip(!me.data.platformAdmin, "PLATFORM_ADMIN_EMAILS ne contient pas demo@manaresto.pf sur ce serveur");

  await page.goto("/platform");
  await expect(page.getByRole("heading", { name: "Vos restaurants ManaResto" })).toBeVisible();
  await expect(page.getByText("Restaurants inscrits")).toBeVisible();
  await page.getByLabel("Rechercher un restaurant").fill(email);
  const row = page.locator("tr", { hasText: email });
  await expect(row).toBeVisible();
  await expect(row.getByText("Essai", { exact: true })).toBeVisible();
  await expect(row.getByText(/vu (à l'instant|il y a)/)).toBeVisible();

  // Prendre la main puis revenir
  await row.getByRole("button", { name: "Prendre la main" }).click();
  await page.waitForURL(/\/admin/);
  await expect(page.getByText("Mode support")).toBeVisible();
  await expect(page.getByRole("status").getByText(`Tiare Console${stamp}`)).toBeVisible();
  await page.getByRole("button", { name: "Revenir à la console" }).click();
  await expect(page.getByRole("heading", { name: "Vos restaurants ManaResto" })).toBeVisible();

  // Activer l'abonnement
  await page.getByLabel("Rechercher un restaurant").fill(email);
  await row.getByLabel(/Changer le statut/).selectOption("ACTIVE");
  await expect(row.getByText("Actif", { exact: true })).toBeVisible();
  await expect(row.getByText("12 000 F / mois")).toBeVisible();

  // Bloquer : le restaurateur ne peut plus se connecter
  await row.getByRole("button", { name: "Bloquer" }).click();
  await page.getByPlaceholder(/impayé/).fill("compte de test");
  await page.getByRole("button", { name: "Bloquer le compte" }).click();
  await expect(row.getByText("Bloqué", { exact: true })).toBeVisible();
  const login = await other.post("/api/auth/login", { data: { email, password: "motdepasse1" } });
  expect(login.status()).toBe(403);
  expect((await login.json()).error.message).toMatch(/suspendu/);

  // Fiche détaillée
  await row.locator("td").first().click();
  await expect(page.getByText("Équipe et connexions")).toBeVisible();
  await expect(page.getByRole("dialog").getByText(email).first()).toBeVisible();
  await other.dispose();
  expect(errors).toEqual([]);
});
