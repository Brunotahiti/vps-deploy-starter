import { test, expect } from "@playwright/test";

/**
 * Portail « Commande » sur téléphone : ouvrir une table, commander, envoyer en cuisine ; modifier un plat déjà
 * en préparation (confirmation, « MODIFICATION URGENTE » en cuisine, vue puis appliquée), puis l'annuler.
 */
test("commande en salle au téléphone et circuit des modifications avec la cuisine", async ({ browser }) => {
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await phone.newPage();
  const note = `Sans oignons ${Date.now().toString(36).slice(-4)}`; // unique : la cuisine garde les messages récents
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  await page.goto("/pos/m");
  await expect(page.getByTestId("portal-dock").getByRole("link", { name: "Commande" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("waiter-table").first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("commande-tables.png") });
  await page.getByTestId("waiter-table").filter({ hasText: "Libre" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "2", exact: true }).click();
  await page.waitForURL(/\/pos\/m\/[0-9a-f-]{36}$/);
  const orderId = page.url().split("/").pop()!;
  await expect(page.getByTestId("waiter-product").first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("commande-carte.png") });

  await page.getByLabel("Chercher un plat").fill("Poisson cru");
  await page.getByTestId("waiter-product").first().click();
  const add = page.getByRole("button", { name: /^Ajouter ·/ });
  if (await add.isVisible().catch(() => false)) await add.click();
  await page.getByTestId("send-kitchen").click();
  await expect(page.getByTestId("sent-burst")).toBeVisible();
  await expect(page.getByTestId("dish-stage").first()).toContainText("Nouvelle");

  // La cuisine commence le plat
  const order = (await (await page.request.get(`/api/orders/${orderId}`)).json()).data;
  const ticketId = order.items.find((i: { kitchenTicketId: string | null }) => i.kitchenTicketId).kitchenTicketId;
  expect((await page.request.post(`/api/kitchen/tickets/${ticketId}/status`, { data: { status: "IN_PROGRESS" } })).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("tab", { name: /La commande/ }).click();
  await expect(page.getByTestId("dish-stage").first()).toContainText("En préparation");
  await page.screenshot({ path: test.info().outputPath("commande-suivi.png") });

  // Modification d'un plat en préparation : confirmation puis message urgent pour la cuisine
  await page.getByRole("button", { name: "Modifier" }).first().click();
  await page.getByLabel("Note pour la cuisine").fill(note);
  await expect(page.getByTestId("modify-summary")).toContainText("MODIFICATION URGENTE");
  await page.getByRole("button", { name: "Envoyer la modification à la cuisine" }).click();
  await expect(page.getByTestId("confirm-modify")).toContainText("Le plat est déjà en préparation. Confirmer la modification ?");
  await page.screenshot({ path: test.info().outputPath("commande-confirmation.png") });
  await page.getByRole("button", { name: "Oui, prévenir la cuisine" }).click();
  await expect(page.getByTestId("waiter-change").first()).toContainText("Envoyée à la cuisine");

  // Écran cuisine : « MODIFICATION URGENTE — TABLE … », vue puis appliquée
  const kitchenCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const kds = await kitchenCtx.newPage();
  await kds.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  await kds.goto("/kds");
  const card = kds.getByTestId("kitchen-change").filter({ hasText: note }).first();
  await expect(card).toContainText("MODIFICATION URGENTE");
  await kds.screenshot({ path: test.info().outputPath("cuisine-modification.png") });
  await card.getByRole("button", { name: /Vu/ }).click();
  await card.getByRole("button", { name: /Modification appliquée/ }).click();
  await expect(card).toContainText("Modification appliquée");

  await page.reload();
  await page.getByRole("tab", { name: /La commande/ }).click();
  await expect(page.getByTestId("waiter-change").first()).toContainText("Appliquée");

  // Annulation : plat en préparation → confirmation, puis « ANNULATION » en cuisine
  await page.getByRole("button", { name: "Annuler" }).first().click();
  await page.getByRole("button", { name: "Erreur de saisie" }).click();
  await page.getByRole("button", { name: "Demander l'annulation" }).click();
  await expect(page.getByTestId("confirm-cancel")).toContainText("Voulez-vous quand même demander l'annulation ?");
  await page.getByRole("button", { name: "Oui, annuler" }).click();
  await expect(page.getByText("Annulés")).toBeVisible();
  await kds.reload();
  await expect(kds.getByTestId("kitchen-change").filter({ hasText: "ANNULATION" }).first()).toBeVisible();
  await kitchenCtx.close();
  await phone.close();
});
