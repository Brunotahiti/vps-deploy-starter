import { test, expect } from "@playwright/test";

/** Carte cadeau : vendue en gestion (imprimée), puis utilisée comme moyen de paiement à la caisse. */
test("carte cadeau : vente, impression, paiement à la caisse", async ({ page, context }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });

  await page.goto("/admin/marketing");
  await page.getByTestId("giftcard-sell").click();
  await page.getByLabel("Montant de la carte").fill("2500");
  await page.getByLabel("Bénéficiaire").fill("Test e2e");
  const [card] = await Promise.all([context.waitForEvent("page"), page.getByTestId("giftcard-save").click()]);
  await card.waitForLoadState();
  const code = (await card.locator(".code").textContent())!.trim();
  expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  await expect(card.locator(".card")).toContainText("Test e2e");
  await card.close();
  await expect(page.getByTestId("giftcard-row").filter({ hasText: code })).toBeVisible();

  // Caisse : une eau payée avec la carte (code tapé en minuscules, sans tiret)
  await page.goto("/pos");
  await page.getByRole("button", { name: "Comptoir", exact: true }).click();
  await page.waitForURL(/\/pos\/order\//);
  await page.getByRole("button", { name: "Boissons" }).click();
  await page.getByRole("button", { name: "Ajouter Eau minérale 50 cl" }).click();
  const orderId = page.url().split("/pos/order/")[1];
  await page.getByRole("button", { name: /Payer/ }).click();
  await page.getByTestId("pay-gift").click();
  await page.getByLabel("Code de la carte cadeau").fill(code.replace("-", "").toLowerCase());
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page.getByTestId("gift-balance")).toContainText("2 500");
  await page.getByRole("button", { name: /^Encaisser/ }).click();
  await expect(page.getByRole("heading", { name: "Commande soldée" })).toBeVisible();
  const order = await (await page.request.get(`/api/orders/${orderId}`)).json();
  expect(order.data.payments[0]).toMatchObject({ method: "GIFT_CARD", reference: code });
  const left = await (await page.request.get(`/api/gift-cards/lookup?code=${code}`)).json();
  expect(left.data.balance).toBe(2500 - order.data.total);
});
