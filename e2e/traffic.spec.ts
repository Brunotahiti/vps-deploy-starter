import { test, expect, request as pwRequest } from "@playwright/test";

/**
 * Fréquentation : une page vue envoyée par la balise du site vitrine et la connexion de l'administrateur
 * apparaissent dans le tableau de bord de la console plateforme (PLATFORM_ADMIN_EMAILS=demo@manaresto.pf).
 */
test("console : la fréquentation du site et les connexions s'affichent", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // Balise du site vitrine (corps text/plain comme navigator.sendBeacon)
  const visitor = await pwRequest.newContext({ baseURL, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1" });
  const hit = await visitor.post("/api/public/visit", { headers: { "Content-Type": "text/plain" }, data: JSON.stringify({ type: "view", path: "/", referrer: "https://www.google.com/" }) });
  expect(hit.status()).toBe(204);
  expect((await visitor.post("/api/public/visit", { headers: { "Content-Type": "text/plain" }, data: JSON.stringify({ type: "click", name: "cta_trial", path: "/" }) })).status()).toBe(204);

  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("demo@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(admin|pos)/);
  const me = await (await page.request.get("/api/auth/me")).json();
  test.skip(!me.data.platformAdmin, "PLATFORM_ADMIN_EMAILS ne contient pas demo@manaresto.pf sur ce serveur");

  await page.goto("/platform");
  const panel = page.getByTestId("traffic");
  await expect(panel.getByRole("heading", { name: "Fréquentation" })).toBeVisible();
  await expect(panel.getByTestId("traffic-live")).toContainText(/visiteur/);
  await expect(panel.getByText("Visites du site", { exact: true }).first()).toBeVisible();
  await expect(panel.getByText("Quand vient-on sur le site ?")).toBeVisible();
  await expect(panel.getByText("google.com").first()).toBeVisible();
  await expect(panel.getByText("« Essayer gratuitement »").first()).toBeVisible();
  // Sa propre connexion figure dans les connexions récentes
  await expect(panel.getByText("E-mail et mot de passe").first()).toBeVisible();
  await panel.getByRole("button", { name: "7 jours" }).click();
  await expect(panel.getByRole("button", { name: "7 jours" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByText("Visites par jour")).toBeVisible();
  expect(errors).toEqual([]);
});
