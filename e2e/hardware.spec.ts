import { test, expect } from "@playwright/test";

/** Imprimante Epson connectée avec tiroir-caisse : ajout, adresse à saisir, connexion de l'imprimante, ouverture du tiroir depuis la caisse. */
test("imprimante connectée et tiroir-caisse", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("demo@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin|onboarding)/);

  await page.goto("/admin/hardware");
  await page.getByRole("button", { name: /Ajouter une imprimante/ }).click();
  const name = `Caisse e2e ${Date.now()}`;
  await page.getByLabel("Nom").fill(name);
  await page.getByRole("switch", { name: "Tiroir-caisse branché" }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();

  // L'adresse à saisir dans l'imprimante n'est montrée qu'une fois
  const url = (await page.getByTestId("cloud-url").textContent())!.trim();
  expect(url).toMatch(/\/api\/hardware\/cloud\/[A-Za-z0-9_-]{20,}$/);
  await page.getByRole("button", { name: "J'ai saisi l'adresse" }).click();
  const card = page.getByTestId("printer-card").filter({ hasText: name });
  await expect(card.getByText("Jamais connectée")).toBeVisible();
  await expect(card.getByText("Tiroir-caisse branché")).toBeVisible();

  // L'imprimante interroge ManaResto (Server Direct Print) : elle passe « En ligne »
  const path = new URL(url).pathname;
  const poll = await page.request.post(path, { form: { ConnectionType: "GetRequest", ID: "caisse" } });
  expect(poll.status()).toBe(200);
  await page.reload();
  await expect(card.getByText(/En ligne/)).toBeVisible();

  // Écran Caisse : ouverture du tiroir sans vente, avec motif
  await page.goto("/pos/cash");
  await page.getByRole("button", { name: "Ouvrir le tiroir" }).click();
  await page.getByRole("button", { name: "Faire de la monnaie" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Ouvrir le tiroir" }).click();
  await expect(page.getByText(/Tiroir-caisse : transmis/)).toBeVisible();

  // L'imprimante récupère l'impulsion d'ouverture
  const job = await (await page.request.post(path, { form: { ConnectionType: "GetRequest" } })).text();
  expect(job).toContain('<pulse drawer="drawer_1"');

  // Nettoyage : l'imprimante de test est supprimée
  await page.goto("/admin/hardware");
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("printer-card").filter({ hasText: name }).getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByTestId("printer-card").filter({ hasText: name })).toBeHidden();
});
