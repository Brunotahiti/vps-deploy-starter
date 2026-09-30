import { test, expect } from "@playwright/test";

/** Invitation par e-mail : création depuis Utilisateurs, acceptation par le lien, entrée directe dans la caisse ; page Statistiques. */
test("inviter un membre, accepter l'invitation, statistiques", async ({ page, browser }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("demo@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);

  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Inviter par e-mail" }).click();
  const email = `invite-${Date.now()}@test.pf`;
  await page.getByLabel("Adresse e-mail").fill(email);
  await page.getByLabel("Prénom", { exact: true }).fill("Vaimiti");
  await page.getByLabel("Nom", { exact: true }).fill("Teiho");
  await page.getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(page.getByTestId("invite-sent")).toBeVisible();
  const url = (await page.getByTestId("invite-url").textContent())!.trim();
  expect(url).toMatch(/\/invitation\/[A-Za-z0-9_-]{32}$/);
  await page.getByRole("button", { name: "Fermer", exact: true }).last().click();
  await expect(page.getByText("invitation en attente").first()).toBeVisible();

  // L'invité ouvre le lien dans un autre navigateur (sans session)
  const ctx = await browser.newContext();
  const guest = await ctx.newPage();
  await guest.goto(url);
  await expect(guest.getByRole("heading", { name: /Bienvenue, Vaimiti/ })).toBeVisible();
  await guest.getByLabel("Mot de passe (8 caractères minimum)").fill("motdepasse1");
  await guest.getByLabel("Confirmer le mot de passe").fill("motdepasse1");
  await guest.getByLabel(/PIN de caisse/).fill("5678");
  await guest.getByRole("button", { name: "Créer mon accès et entrer" }).click();
  await guest.waitForURL(/\/pos/, { timeout: 15_000 });
  const me = await (await guest.request.get("/api/auth/me")).json();
  expect(me.data.user.email).toBe(email);
  // Le lien est consommé
  await guest.goto(url);
  await expect(guest.getByText("Invitation introuvable")).toBeVisible();
  await ctx.close();

  // Statistiques : bandeau, faits marquants, graphiques
  await page.goto("/admin/stats");
  await expect(page.getByRole("heading", { name: "Statistiques" })).toBeVisible();
  await expect(page.getByTestId("stats-revenue")).toContainText("F");
  await expect(page.getByTestId("stats-highlights")).toBeVisible();
  await page.getByRole("button", { name: "7 jours" }).click();
  await expect(page.getByText("Top 10 produits")).toBeVisible();
  await expect(page.getByText("Moyens de paiement")).toBeVisible();
});
