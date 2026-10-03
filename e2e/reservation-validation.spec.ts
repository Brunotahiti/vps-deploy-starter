import { test, expect } from "@playwright/test";

/** Réservation en ligne : e-mail obligatoire côté client, grand message pour l'équipe, confirmation en un geste. */
test("demande de réservation en ligne : e-mail obligatoire, alerte à la caisse, confirmation", async ({ page, context }) => {
  const name = `Client e2e ${Date.now().toString().slice(-5)}`;
  const client = await context.newPage();
  await client.goto("/reserver/demo-mana-beach/le-mana-beach");
  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await client.getByLabel("Date").fill(tomorrow);
  await client.getByLabel("Votre nom").fill(name);
  await client.getByLabel("Téléphone").fill(`87 ${Date.now().toString().slice(-6)}`);
  const send = client.getByRole("button", { name: "Envoyer la demande" });
  await expect(send).toBeDisabled(); // pas d'e-mail : impossible d'envoyer
  await client.getByLabel("E-mail").fill("client-e2e");
  await expect(client.getByText("Adresse e-mail invalide")).toBeVisible();
  await expect(send).toBeDisabled();
  await client.getByLabel("E-mail").fill("client-e2e@exemple.pf");
  await expect(client.getByText("Obligatoire : vous recevez la réponse du restaurant par e-mail.")).toBeVisible();
  await send.click();
  await expect(client.getByText(/répond par e-mail/)).toBeVisible();
  await client.close();

  // L'équipe : grand message dès l'ouverture de la caisse, avec la demande et ses boutons
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  await page.goto("/pos");
  const card = page.getByTestId("pending-card").filter({ hasText: name });
  await expect(card).toBeVisible();
  await expect(card).toContainText("client-e2e@exemple.pf");
  await card.getByTestId("pending-confirm").click();
  await expect(page.getByText(new RegExp(`Réservation de ${name} confirmée`))).toBeVisible();
  await expect(card).toHaveCount(0);

  // Demandes plus anciennes : signalées par le bandeau, qui ouvre la liste ; « Plus tard » la referme
  const pending = (await (await page.request.get("/api/reservations/pending")).json()).data as unknown[];
  if (pending.length) {
    await expect(page.getByTestId("pending-banner")).toBeVisible();
    await page.getByTestId("pending-banner").click();
    await expect(page.getByTestId("pending-list")).toBeVisible();
    await page.getByTestId("pending-later").click();
    await expect(page.getByTestId("pending-list")).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("pending-banner")).toBeVisible();
    await expect(page.getByTestId("pending-list")).toHaveCount(0); // rien de nouveau : pas de grand message
  }
});
