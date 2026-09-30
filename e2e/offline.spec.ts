import { test, expect } from "@playwright/test";

/**
 * Mode hors ligne (PWA) : la caisse continue de fonctionner sans réseau et se
 * synchronise à la reconnexion sans dupliquer les opérations.
 * Nécessite un build de production (service worker actif).
 */
test("hors ligne : ouvrir une table, commander, envoyer, puis synchroniser", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  await page.goto("/pos");
  await expect(page.locator("header [data-testid=network-status][data-online=true]")).toBeVisible();
  // Laisser le service worker s'installer et le catalogue se mettre en cache
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15000 }).catch(() => {});
  const freeBefore = page.locator("button[title='Libre']:visible").first();
  const tableName = (await freeBefore.getByTestId("table-name").textContent())?.trim();

  // ---- Coupure réseau
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator("header [data-testid=network-status][data-online=false]")).toBeVisible();

  await page.locator("button[title='Libre']:visible").first().click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.waitForURL(/\/pos\/order\//);
  const orderId = page.url().split("/pos/order/")[1];
  await expect(page.getByText("hors ligne", { exact: false }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByTestId("ticket").getByText(`Table ${tableName}`)).toBeVisible();

  await page.getByRole("button", { name: "Boissons" }).click();
  const grid = page.locator("section").first();
  await grid.getByRole("button", { name: "Ajouter Coca-Cola 33 cl" }).click();
  await grid.getByRole("button", { name: "Ajouter Coca-Cola 33 cl" }).click();
  await expect(page.getByTestId("ticket").getByText("Coca-Cola 33 cl")).toHaveCount(2);
  await expect(page.getByTestId("ticket").getByText("900 F").first()).toBeVisible();

  await page.getByRole("button", { name: /Envoyer/ }).click();
  await page.getByRole("button", { name: "Tout envoyer" }).click();
  await expect(page.getByTestId("ticket").getByText("envoyé").first()).toBeVisible();
  await expect(page.locator("header [data-testid=network-status]")).toHaveAttribute("aria-label", /à synchroniser/);

  // Retour salle hors ligne : la table apparaît occupée grâce à la commande locale
  await page.getByRole("button", { name: "Salle" }).first().click();
  await page.waitForURL(/\/pos$/);
  await expect(page.locator(`button[title='Commande en cours']:visible`).filter({ hasText: tableName! })).toBeVisible();

  // ---- Reconnexion : synchronisation
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(/Synchronisation : 4 opérations transmises/)).toBeVisible({ timeout: 15000 });
  await expect(page.locator("header [data-testid=network-status][data-online=true]")).toBeVisible();

  const res = await page.request.get(`/api/orders/${orderId}`);
  expect(res.ok()).toBe(true);
  const order = (await res.json()).data;
  expect(order.status).toBe("SENT");
  expect(order.items.length).toBe(2);
  expect(order.items.every((i: { status: string }) => i.status === "SENT")).toBe(true);
  expect(order.total).toBe(900);
  expect(order.courses.length).toBe(4);

  // Nettoyage : annuler la commande de test
  await page.request.post(`/api/orders/${orderId}/cancel`, { data: { reason: "test hors ligne" } });
});
