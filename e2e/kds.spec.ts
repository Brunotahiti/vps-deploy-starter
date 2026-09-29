import { test, expect } from "@playwright/test";

/** Phase 3 : le cuisinier accepte, prépare et marque prêt un ticket ; la salle voit le plat prêt. */
test("écran cuisine : accepter → en préparation → prêt → terminé", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);

  // Crée une commande comptoir et l'envoie : un ticket NOUVEAU apparaît
  const catalog = await (await page.request.get("/api/pos/catalog")).json();
  const product = catalog.data.products.find((p: { name: string }) => p.name === "Eau minérale 50 cl");
  const created = await (await page.request.post("/api/orders", { data: { type: "COUNTER", customerName: "Test KDS" } })).json();
  await page.request.post(`/api/orders/${created.data.id}/items`, { data: { productId: product.id, quantity: 2 } });
  await page.request.post(`/api/orders/${created.data.id}/send`, { data: { all: true } });

  await page.goto("/kds");
  const card = page.locator("article", { hasText: "Test KDS" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("2 × Eau minérale 50 cl")).toBeVisible();
  await card.getByRole("button", { name: /^ACCEPTER/ }).click();
  await expect(card.getByRole("button", { name: /^EN PRÉPARATION/ })).toBeVisible();
  await card.getByRole("button", { name: /^EN PRÉPARATION/ }).click();
  await expect(card.getByRole("button", { name: /^PRÊT/ })).toBeVisible();
  await card.getByRole("button", { name: /^PRÊT/ }).click();

  // Le ticket passe dans « Prêts » ; la commande voit l'article prêt
  await page.getByRole("button", { name: /Prêts/ }).click();
  const ready = page.locator("article", { hasText: "Test KDS" }).first();
  await expect(ready).toBeVisible();
  const itemStatus = async () => (await (await page.request.get(`/api/orders/${created.data.id}`)).json()).data.items[0].status;
  await expect.poll(itemStatus).toBe("READY");
  await ready.getByRole("button", { name: /^TERMINÉ/ }).click();
  await expect(ready).toBeHidden();
  await expect.poll(itemStatus).toBe("SERVED");

  // Bon cuisine imprimable
  const tickets = await (await page.request.get("/api/kitchen/tickets?includeDone=1")).json();
  const mine = tickets.data.find((t: { order: { id: string } }) => t.order.id === created.data.id);
  const html = await (await page.request.get(`/api/kitchen/tickets/${mine.id}/print?format=html`)).text();
  expect(html).toContain("Eau minérale 50 cl");
  await page.request.post(`/api/orders/${created.data.id}/cancel`, { data: { reason: "Test / formation" } });
});

test("le rôle cuisine arrive directement sur l'écran cuisine", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("cuisine@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/kds/);
  await expect(page.getByRole("button", { name: /^Tous/ })).toBeVisible();
});
