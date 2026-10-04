import { test, expect, type Page } from "@playwright/test";

const meEmail = async (page: Page) => (await (await page.request.get("/api/auth/me")).json()).data.user?.email ?? null;

/**
 * Nouveau compte, tableau de bord vide : « Voir une session en live » ouvre le restaurant exemple en plein service,
 * le bandeau « Revenir à mon restaurant » ramène dans son propre compte, sans se reconnecter.
 */
test("session en live : restaurant exemple puis retour à son restaurant", async ({ page }) => {
  const stamp = Date.now();
  const email = `live${stamp}@test.pf`;
  const res = await page.request.post("/api/auth/signup", { data: { organizationName: `Snack Live ${stamp}`, establishmentName: "Snack du lagon", firstName: "Teva", lastName: "Live", email, password: "motdepasse1" } });
  expect(res.ok()).toBeTruthy();

  await page.goto("/admin");
  // Programme de base : pas de site public (option Digital), donc pas de lien « Voir mon site en ligne »
  await page.getByRole("button", { name: "Salle & clients" }).first().click();
  await expect(page.getByRole("link", { name: /Plan de salle/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Voir mon site en ligne/ })).toHaveCount(0);
  const card = page.getByTestId("live-demo-card");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Voir une session en live" }).click();
  await page.waitForURL(/\/admin$/);

  // Dans le restaurant exemple : chiffres remplis, bandeau de retour, pas de carte « live »
  const bar = page.getByTestId("demo-visit-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("restaurant exemple Le Mana Beach");
  expect(await meEmail(page)).toBe("demo@manaresto.pf");
  await expect(page.getByTestId("live-demo-card")).toHaveCount(0);
  // Le bandeau suit sur la caisse
  await page.goto("/pos");
  await expect(page.getByTestId("demo-visit-bar")).toBeVisible();

  // Retour à son restaurant, sans mot de passe
  await page.getByRole("button", { name: /Revenir à mon restaurant \(Snack du lagon\)/ }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByTestId("demo-visit-bar")).toHaveCount(0);
  await expect(page.getByTestId("live-demo-card")).toBeVisible();
  expect(await meEmail(page)).toBe(email);
  // Plus de retour possible une fois revenu
  expect((await page.request.post("/api/auth/demo-return")).status()).toBe(401);
});

/** Lien de l'e-mail de bienvenue alors qu'on est déjà connecté : sa session est gardée ; la déconnexion ferme les deux. */
test("lien /login?demo=1 connecté : retour possible, déconnexion complète", async ({ page }) => {
  const stamp = Date.now();
  const email = `lien${stamp}@test.pf`;
  expect((await page.request.post("/api/auth/signup", { data: { organizationName: `Roulotte ${stamp}`, establishmentName: "Roulotte Live", firstName: "Hina", lastName: "Lien", email, password: "motdepasse1" } })).ok()).toBeTruthy();
  await page.goto("/login?demo=1");
  await page.waitForURL(/\/admin$/, { timeout: 20000 });
  await expect(page.getByTestId("demo-visit-bar")).toBeVisible();
  expect(await meEmail(page)).toBe("demo@manaresto.pf");

  await page.request.post("/api/auth/logout");
  expect(await meEmail(page)).toBeNull();
  expect((await page.request.post("/api/auth/demo-return")).status()).toBe(401); // la session mise de côté est fermée aussi
});

test("visite guidée : seulement pour un visiteur de la démo, étapes cochées en ouvrant les écrans", async ({ page }) => {
  await page.goto("/login?demo=1");
  await page.waitForURL(/\/admin/);
  const tour = page.getByTestId("demo-tour");
  await expect(tour).toContainText("1/4"); // le tableau de bord coche « Vos chiffres »
  await tour.getByRole("link", { name: "Y aller" }).filter({ visible: true }).click();
  await page.waitForURL(/\/pos$/);
  await expect(page.getByTestId("demo-tour")).toContainText("2/4");
  await page.goto("/kds");
  await expect(page.getByTestId("demo-tour")).toContainText("3/4");
  // Réduite, elle le reste après un rechargement ; fermée, elle ne revient plus
  await page.getByRole("button", { name: "Réduire la visite guidée" }).click();
  await page.reload();
  await expect(page.getByTestId("demo-tour-pill")).toBeVisible();
  await page.getByTestId("demo-tour-pill").click();
  await page.getByTestId("demo-tour-close").click();
  await page.reload();
  await expect(page.getByTestId("demo-tour-pill")).toHaveCount(0);
  await expect(page.getByTestId("demo-tour")).toHaveCount(0);
});

test("visite guidée : absente après une connexion par mot de passe au compte exemple", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  await page.goto("/pos");
  await expect(page.getByRole("button", { name: /Comptoir/ })).toBeVisible();
  await expect(page.getByTestId("demo-tour")).toHaveCount(0);
  await expect(page.getByTestId("demo-tour-pill")).toHaveCount(0);
});
