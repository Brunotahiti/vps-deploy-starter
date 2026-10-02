import { test, expect } from "@playwright/test";

/** Comptes clients pro : créer un compte, mettre une addition « sur compte » à la caisse, facturer, encaisser le règlement. */
test("compte client pro : sur compte, facture PDF, règlement", async ({ page, context }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  const name = `Société test ${Date.now().toString(36)}`; // unique : relançable sur la même base

  // Gestion → Comptes clients pro : nouveau compte
  await page.goto("/admin/accounts");
  await page.getByTestId("account-new").click();
  await page.getByLabel("Raison sociale").fill(name);
  await page.getByLabel("N° Tahiti du client").fill("B98765");
  await page.getByLabel("Plafond d'encours").fill("50000");
  await page.getByTestId("account-save").click();
  await expect(page.getByTestId("account-row").filter({ hasText: name })).toBeVisible();

  // Caisse : une eau au comptoir, mise sur le compte
  await page.goto("/pos");
  await page.getByRole("button", { name: "Comptoir", exact: true }).click();
  await page.waitForURL(/\/pos\/order\//);
  await page.getByRole("button", { name: "Boissons" }).click();
  await page.getByRole("button", { name: "Ajouter Eau minérale 50 cl" }).click();
  await expect(page.getByTestId("ticket").getByText("Eau minérale 50 cl")).toBeVisible();
  const orderId = page.url().split("/pos/order/")[1];
  await page.getByRole("button", { name: /Payer/ }).click();
  await page.getByTestId("pay-account").click();
  const picker = page.getByTestId("account-picker");
  await picker.getByLabel("Rechercher un compte").fill(name);
  await picker.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: /Mettre sur compte/ }).click();
  await expect(page.getByRole("heading", { name: "Commande soldée" })).toBeVisible();
  const order = await (await page.request.get(`/api/orders/${orderId}`)).json();
  expect(order.data.status).toBe("PAID");
  expect(order.data.payments[0].method).toBe("ACCOUNT");
  const amount: number = order.data.total;

  // Fiche du compte : encours, facture PDF, règlement
  await page.goto("/admin/accounts");
  await page.getByTestId("account-row").filter({ hasText: name }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  // La facture s'ouvre dans un nouvel onglet (PDF) ; on vérifie le document via son lien
  await Promise.all([context.waitForEvent("page"), page.getByTestId("account-invoice").click()]);
  const href = await page.getByTestId("invoice-row").getByRole("link", { name: "PDF" }).getAttribute("href");
  const doc = await page.request.get(href!);
  expect(doc.headers()["content-type"]).toBe("application/pdf");
  expect((await doc.body()).subarray(0, 4).toString()).toBe("%PDF");
  await expect(page.getByTestId("invoice-row")).toHaveCount(1);
  await expect(page.getByTestId("invoice-row")).toContainText("À régler");

  await page.getByTestId("account-settle").click();
  await expect(page.getByLabel("Montant du règlement")).toHaveValue(String(amount));
  await page.getByLabel("Référence").fill("Virement test");
  await page.getByTestId("settlement-save").click();
  await expect(page.getByTestId("invoice-row")).toContainText("Réglée");
  await expect(page.getByTestId("account-balance")).toHaveText(/^0\sF/);
});
