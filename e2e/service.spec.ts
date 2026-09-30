import { test, expect } from "@playwright/test";

/** Phase 9 : suivi de service — rappel à l'installation, panneau « À faire maintenant », onglet Service, badge sur le plan. */
test("suivi de service : installer une table crée un rappel, le panneau permet de le traiter, l'onglet Service montre le parcours", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  // Délai d'accueil à 0 pour que le rappel soit dû immédiatement
  await page.request.patch("/api/service/settings", { data: { enabled: true, delays: { welcome: 0 } } });
  await page.goto("/pos");
  const free = page.locator("button[title='Libre']:visible").first();
  const tableName = (await free.getByTestId("table-name").textContent())?.trim();
  await free.click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.waitForURL(/\/pos\/order\//);
  const orderId = page.url().split("/pos/order/")[1];

  // Onglet Service : prochaine action et parcours en 9 étapes
  await page.getByRole("tab", { name: "Service" }).click();
  const ticket = page.getByTestId("ticket");
  await expect(ticket.getByText("Accueillir la table et proposer les boissons")).toBeVisible();
  await expect(ticket.getByText("Parcours de service")).toBeVisible();
  await expect(ticket.getByText("Accueil de la table")).toBeVisible();

  // Panneau « À faire maintenant » : le rappel de cette table est listé, « Fait » le traite
  await page.getByTestId("todo-button").first().click();
  const panel = page.getByTestId("todo-panel");
  await expect(panel.getByText("À faire maintenant")).toBeVisible();
  const row = panel.locator("li", { hasText: "Accueillir la table" }).filter({ hasText: tableName ?? "" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Fait" }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole("button", { name: "Fermer" }).click();

  // L'étape « boissons » est validée et l'audit a tracé l'action
  const tl = await (await page.request.get(`/api/service/orders/${orderId}/timeline`)).json();
  expect(tl.data.steps.find((s: { key: string }) => s.key === "drinks_order").status).toBe("DONE");
  expect(tl.data.events.some((e: { kind: string }) => e.kind === "seated")).toBe(true);

  // Une étape marquée « non nécessaire » depuis l'API, visible dans l'onglet
  await page.request.post(`/api/service/orders/${orderId}/steps/dessert_offer`, { data: { status: "NOT_NEEDED", reason: "Formule sans dessert" } });
  await page.reload();
  await page.getByRole("tab", { name: "Service" }).click();
  await expect(page.getByTestId("ticket").getByText("Formule sans dessert").first()).toBeVisible();

  // Nettoyage : annulation de la commande
  await page.request.post(`/api/orders/${orderId}/cancel`, { data: { reason: "test e2e" } });
});
