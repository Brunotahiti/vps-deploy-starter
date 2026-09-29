import { test, expect, type Page } from "@playwright/test";

/**
 * Parcours E2E prioritaire :
 * connexion serveur → ouverture table → ajout produits → options → envoi cuisine
 * → addition → division → paiement → fermeture table → rapport de caisse.
 * (Le KDS « plat prêt » est prévu en Phase 3 ; les tickets cuisine sont vérifiés via l'API.)
 */
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill(email);
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
}

async function ensureCashOpen(page: Page) {
  const r = await page.request.get("/api/cash/current");
  const body = await r.json();
  if (!body.data) {
    await page.request.post("/api/cash/open", { data: { openingFloat: 30000 } });
  }
}

test("caisse : de l'ouverture de table au rapport de caisse", async ({ page }) => {
  await login(page, "manager@manaresto.pf");
  await ensureCashOpen(page);
  await page.goto("/pos");

  // Plan de salle : ouvrir une table libre
  await expect(page.getByRole("button", { name: /Comptoir/ })).toBeVisible();
  const freeTable = page.locator("button[title='Libre']").first();
  await expect(freeTable).toBeVisible();
  const tableName = (await freeTable.locator("span").first().textContent())?.trim();
  await freeTable.click();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await page.waitForURL(/\/pos\/order\//);
  await expect(page.getByText(`Table ${tableName}`)).toBeVisible();

  // Ajouter un produit simple (boisson)
  await page.getByRole("button", { name: "Boissons" }).click();
  await page.getByRole("button", { name: /Eau minérale 50 cl/ }).click();
  await expect(page.locator("aside").last().getByText("Eau minérale 50 cl")).toBeVisible();

  // Ajouter un produit avec options obligatoires (burger)
  await page.getByRole("button", { name: "Plats", exact: true }).click();
  await page.getByRole("button", { name: /^Burger Bacon/ }).click();
  await expect(page.getByRole("heading", { name: "Burger Bacon" })).toBeVisible();
  await page.getByRole("button", { name: "Saignant" }).click();
  await page.getByRole("button", { name: "Salade", exact: true }).click();
  await page.getByRole("button", { name: /Bacon\s*\+/ }).click();
  await page.getByRole("button", { name: /Ajouter/ }).click();
  await expect(page.locator("aside").last().getByText("Burger Bacon")).toBeVisible();
  await expect(page.locator("aside").last().getByText("Saignant, Salade, Bacon")).toBeVisible();

  // Total attendu : 350 + 2100 + 250 = 2 700 F
  await expect(page.locator("aside").last().getByText("2 700 F").first()).toBeVisible();

  // Envoi en cuisine (menu déroulant multi-services → tout envoyer)
  await page.getByRole("button", { name: /Envoyer/ }).click();
  await page.getByRole("button", { name: "Tout envoyer" }).click();
  await expect(page.getByText("Envoyé en cuisine")).toBeVisible();
  await expect(page.locator("aside").last().getByText("envoyé").first()).toBeVisible();

  // Tickets cuisine créés (API) — le KDS visuel arrive en Phase 3
  const orderId = page.url().split("/pos/order/")[1];
  const order = await (await page.request.get(`/api/orders/${orderId}`)).json();
  expect(order.data.status).toBe("SENT");
  expect(order.data.items.every((i: { status: string }) => i.status === "SENT")).toBe(true);

  // Addition demandée
  await page.locator("aside").last().locator("button").filter({ has: page.locator("svg.lucide-receipt") }).click();
  await expect(page.getByText("Addition demandée")).toBeVisible();

  // Paiement : diviser en 2 parts égales, payer la 1re en espèces, la 2e en carte
  await page.getByRole("button", { name: /Payer/ }).click();
  await page.getByRole("button", { name: /Diviser l'addition/ }).click();
  await page.getByRole("button", { name: /^Part 1/ }).click();
  await page.getByRole("button", { name: "Espèces", exact: true }).click();
  await page.getByRole("button", { name: /Encaisser/ }).click();
  await expect(page.getByText("Paiement enregistré")).toBeVisible();
  await expect(page.getByText("Reste à payer")).toBeVisible();
  await page.getByRole("button", { name: "Carte bancaire" }).click();
  await page.getByRole("button", { name: /Encaisser/ }).click();
  // Dialogue de reçu : imprimer / PDF / e-mail, puis Terminer
  await expect(page.getByRole("heading", { name: "Commande soldée" })).toBeVisible();
  await expect(page.getByPlaceholder("client@exemple.pf")).toBeVisible();
  await page.getByRole("button", { name: "Terminer" }).click();

  // Retour salle : la table est de nouveau libre
  await page.waitForURL(/\/pos$/);
  const paid = await (await page.request.get(`/api/orders/${orderId}`)).json();
  expect(paid.data.status).toBe("PAID");
  expect(paid.data.paidTotal).toBe(2700);
  expect(paid.data.payments.length).toBe(2);

  // Rapport de caisse
  await page.goto("/pos/cash");
  await expect(page.getByText("Espèces théoriques")).toBeVisible();
  await expect(page.getByText("Ventes par moyen de paiement")).toBeVisible();
  await expect(page.getByText("Espèces", { exact: false }).first()).toBeVisible();
});

test("un serveur ne peut pas ouvrir les rapports ni l'administration", async ({ page }) => {
  await login(page, "moana@manaresto.pf");
  const r = await page.request.get("/api/reports/daily");
  expect(r.status()).toBe(403);
  const u = await page.request.get("/api/users");
  expect(u.status()).toBe(403);
});

test("le back-office affiche le tableau de bord et le catalogue", async ({ page }) => {
  await login(page, "demo@manaresto.pf");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  await expect(page.getByText("Chiffre d'affaires")).toBeVisible();
  await expect(page.getByText("CA par heure")).toBeVisible();
  await page.goto("/admin/catalog/products");
  await expect(page.getByText("Burger Bacon")).toBeVisible();
  await page.goto("/admin/floor");
  await expect(page.getByText("T01")).toBeVisible();
});
