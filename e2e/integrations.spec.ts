import { test, expect, type Page } from "@playwright/test";

const field = (page: Page, label: string) => page.locator(`label:has(span:text-is("${label}"))`).locator("input, select, textarea").first();

async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("demo@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
}

/** Phase 7 : clé API créée dans l'administration puis utilisée sur l'API publique v1. */
test("intégrations : créer une clé API et interroger l'API publique", async ({ page }) => {
  await login(page);
  await page.goto("/admin/integrations");
  const keyName = `Test E2E ${Date.now().toString().slice(-6)}`;
  await page.getByRole("button", { name: "Nouvelle clé" }).click();
  await field(page, "Nom (usage)").fill(keyName);
  await page.getByRole("button", { name: "Créer" }).click();
  const key = (await page.locator("code", { hasText: /^mr_live_/ }).textContent())!.trim();
  expect(key.startsWith("mr_live_")).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("tr", { hasText: keyName })).toBeVisible();

  const ctx = page.request;
  const me = await ctx.get("/api/v1/me", { headers: { Authorization: `Bearer ${key}` } });
  expect(me.status()).toBe(200);
  expect((await me.json()).data.establishment.name).toBe("Le Mana Beach");
  const products = await (await ctx.get("/api/v1/products", { headers: { Authorization: `Bearer ${key}` } })).json();
  expect(products.data.categories.length).toBeGreaterThan(0);
  const orders = await (await ctx.get("/api/v1/orders?take=5", { headers: { Authorization: `Bearer ${key}` } })).json();
  expect(orders.data.items.length).toBeGreaterThan(0);
  expect(orders.data.items[0]).toHaveProperty("items");
  // Portée non accordée → 403 ; clé absente → 401
  expect((await ctx.get("/api/v1/stock/ingredients", { headers: { Authorization: `Bearer ${key}` } })).status()).toBe(403);
  expect((await ctx.get("/api/v1/me")).status()).toBe(401);

  // Webhook : création, secret affiché une fois, test (URL injoignable → échec journalisé)
  await page.getByRole("button", { name: "Webhooks" }).click();
  await page.getByRole("button", { name: "Nouveau webhook" }).click();
  const hookUrl = `https://webhook.manaresto-e2e.invalid/${Date.now()}`; // domaine réservé : jamais résolu
  await field(page, "URL (https)").fill(hookUrl);
  await page.getByRole("button", { name: "Créer" }).click();
  await expect(page.locator("code", { hasText: /^whsec_/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(hookUrl)).toBeVisible();

  // Révocation de la clé
  await page.getByRole("button", { name: "Clés API" }).click();
  page.once("dialog", (d) => d.accept());
  await page.locator("tr", { hasText: keyName }).getByRole("button", { name: "Révoquer" }).click();
  await expect(page.getByText(/Clé révoquée/)).toBeVisible();
  expect((await ctx.get("/api/v1/me", { headers: { Authorization: `Bearer ${key}` } })).status()).toBe(401);
});
