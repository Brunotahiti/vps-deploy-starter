import { test, expect } from "@playwright/test";

/** Vente à emporter : nouvelle commande (nom, téléphone, retrait), file « À emporter », « Prête », écran d'appel. */
test("à emporter : commande, prête, numéro à l'écran d'appel", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("demo@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);

  const name = `Emporter ${Date.now().toString(36)}`;
  await page.goto("/pos/emporter");
  await expect(page.getByRole("heading", { name: "À emporter" })).toBeVisible();
  await page.getByTestId("takeaway-new").click();
  await page.getByPlaceholder("Ex. Hina").fill(name);
  await page.getByPlaceholder("87 00 00 00").fill("87 12 34 56");
  await page.getByRole("button", { name: "30 min" }).click();
  await page.getByTestId("takeaway-create").click();
  await page.waitForURL(/\/pos\/order\//);

  // Un article, puis retour à la file
  await page.getByRole("button", { name: "Boissons" }).click();
  await page.getByRole("button", { name: "Ajouter Eau minérale 50 cl" }).click();
  await expect(page.getByTestId("ticket").getByText("Eau minérale 50 cl")).toBeVisible();
  await page.goto("/pos/emporter");
  const card = page.getByTestId("takeaway-card").filter({ hasText: name });
  await expect(card).toBeVisible();
  await expect(card.getByText(/Retrait \d{2}:\d{2}/)).toBeVisible();
  const call = await card.getAttribute("data-call");

  await card.getByTestId("takeaway-ready").click();
  await expect(page.getByTestId("takeaway-col-ready").getByTestId("takeaway-card").filter({ hasText: name })).toBeVisible();

  // Écran d'appel : le numéro apparaît dans « C'est prêt ! », sans le nom du client
  const display = await context.newPage();
  await display.goto("/pos/appel");
  await expect(display.getByTestId("call-ready").getByText(call!, { exact: true })).toBeVisible();
  await expect(display.getByText(name)).toHaveCount(0);
  expect(errors).toEqual([]);
});
