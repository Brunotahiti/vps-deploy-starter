import { test, expect } from "@playwright/test";

/**
 * Réservation au téléphone (programme de base, sans option) : numéro, nom, 4 personnes, demain 19:30, table libre,
 * phrase à relire au client ; la réservation apparaît dans la liste et le planning ; le client qui rappelle est reconnu
 * et la table déjà prise n'est plus proposée.
 */
test("prise de réservation au téléphone, liste, planning et client reconnu", async ({ page }) => {
  const stamp = Date.now();
  expect((await page.request.post("/api/auth/signup", { data: { organizationName: `Resto ${stamp}`, establishmentName: "Chez Hina", firstName: "Hina", lastName: "Resa", email: `resa${stamp}@test.pf`, password: "motdepasse1" } })).ok()).toBeTruthy();
  const room = (await (await page.request.post("/api/rooms", { data: { name: "Salle" } })).json()).data;
  for (const [name, seats] of [["T1", 2], ["T2", 4], ["T3", 6]] as const) expect((await page.request.post("/api/tables", { data: { roomId: room.id, name, seats } })).ok()).toBeTruthy();

  // Le plan de salle montre les réservations du jour et y mène
  await page.goto("/pos");
  await page.getByTestId("floor-reservations").click();
  await page.waitForURL(/\/pos\/reservations$/);
  await expect(page.getByTestId("reservations-screen")).toContainText("Aucune réservation");
  // Choix du jour : calendrier du mois, puis retour à aujourd'hui
  const todayLabel = await page.getByTestId("reservations-day").textContent();
  await page.getByRole("button", { name: "Choisir une date" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath("reservations-calendar.png") });
  await page.getByTestId("date-picker").getByRole("button", { name: "Mois suivant" }).click();
  await page.getByTestId("date-picker").locator("button[aria-label$='-15']").click();
  await expect(page.getByTestId("reservations-day")).toContainText("15");
  await page.getByRole("button", { name: "Aujourd'hui", exact: true }).click();
  await expect(page.getByTestId("reservations-day")).toHaveText(todayLabel!);

  // Programme de base : réservation simple, sans planning ni table attribuée d'avance
  await expect(page.getByRole("tab", { name: /Planning/ })).toHaveCount(0);
  await page.getByTestId("new-reservation").click();
  const simple = page.getByRole("dialog", { name: "Nouvelle réservation" });
  await simple.getByLabel("Téléphone").fill("87 40 40 40");
  await simple.getByLabel("Nom").fill("Teva Simple");
  await simple.getByRole("radio", { name: "3" }).click();
  await simple.getByRole("button", { name: /Dem\./ }).click();
  await simple.getByRole("button", { name: /^12:30/ }).click();
  await expect(simple.getByRole("button", { name: "À placer plus tard" })).toHaveCount(0);
  await expect(page.getByTestId("booking-upsell")).toContainText("option Digital");
  await page.getByRole("button", { name: "Enregistrer la réservation" }).click();
  await expect(page.getByTestId("booking-done")).toContainText("une table pour 3 demain à 12 h 30.");
  await page.getByTestId("booking-done").getByRole("button", { name: "Fermer" }).click();
  await expect(page.getByTestId("reservation-card").filter({ hasText: "Teva Simple" })).toContainText("À placer");
  // Le serveur refuse aussi les fonctions avancées
  expect((await page.request.get("/api/reservations/lookup?phone=87404040")).status()).toBe(403);

  // L'équipe ManaResto active l'option Digital : réservations avancées
  const orgId = (await (await page.request.get("/api/auth/me")).json()).data.organizationId;
  const adminCtx = await page.context().browser()!.newContext();
  const admin = await adminCtx.newPage();
  await admin.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  expect((await admin.request.patch(`/api/platform/orgs/${orgId}/options`, { data: { options: ["digital"] } })).ok()).toBeTruthy();
  await adminCtx.close();
  await page.reload();
  await expect(page.getByRole("tab", { name: /Planning/ })).toBeVisible();
  await page.getByTestId("new-reservation").click();
  const dialog = page.getByRole("dialog", { name: "Nouvelle réservation" });
  await expect(dialog.getByLabel("Téléphone")).toBeFocused();
  await dialog.getByLabel("Téléphone").fill("87 12 34 56");
  await dialog.getByLabel("Nom").fill("Moana Teriitahi");
  await dialog.getByRole("radio", { name: "4" }).click();
  await dialog.getByRole("button", { name: /Dem\./ }).click();
  await dialog.getByRole("button", { name: /^19:30/ }).click();
  // Tables libres : la plus juste d'abord (T2, 4 places)
  await dialog.getByRole("button", { name: /^T2/ }).click();
  await dialog.getByRole("button", { name: /Anniversaire/ }).click();
  await dialog.getByLabel("Allergies").fill("Crustacés");
  await expect(page.getByTestId("booking-summary")).toContainText("19:30 · 4 pers. · table T2");
  await page.getByRole("button", { name: "Enregistrer la réservation" }).click();
  const done = page.getByTestId("booking-done");
  await expect(done).toContainText("C'est noté Moana, une table pour 4 demain à 19 h 30.");
  await page.screenshot({ path: test.info().outputPath("reservation-done.png") });
  await done.getByRole("button", { name: "Fermer" }).click();

  // La journée de demain s'affiche avec la réservation
  const card = page.getByTestId("reservation-card").filter({ hasText: "Moana Teriitahi" });
  await expect(card).toContainText("Table T2");
  await expect(card).toContainText("Crustacés");
  await expect(card).toContainText("prise par Hina");
  await expect(page.getByTestId("week-strip")).toContainText("7 cvts"); // 3 + 4 couverts demain
  await page.screenshot({ path: test.info().outputPath("reservations-list.png"), fullPage: true });

  // Planning des tables : la barre est sur T2 au service du soir
  await page.getByRole("tab", { name: /Planning/ }).click();
  await page.getByRole("button", { name: "Soir" }).click();
  await expect(page.getByTestId("planning-bar").filter({ hasText: "Moana" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("reservations-planning.png"), fullPage: true });

  // Le client rappelle : reconnu, nom repris, T2 déjà prise à 19:30
  await page.getByTestId("new-reservation").click();
  await dialog.getByLabel("Téléphone").fill("87123456");
  await expect(page.getByTestId("caller-card")).toContainText("Client connu : Moana Teriitahi");
  await expect(page.getByTestId("caller-card")).toContainText("Crustacés");
  await expect(dialog.getByLabel("Nom")).toHaveValue("Moana Teriitahi");
  await dialog.getByRole("button", { name: /Dem\./ }).click();
  await dialog.getByRole("button", { name: /^19:30/ }).click();
  await expect(dialog.getByRole("button", { name: /^T2/ })).toHaveCount(0);
  await expect(dialog).toContainText("Déjà réservées sur ce créneau : T2 (Moana 19:30)");
  await page.screenshot({ path: test.info().outputPath("reservation-caller.png") });
});

/** Téléphone : la fenêtre de prise de réservation tient dans l'écran et s'enregistre. */
test("prise de réservation sur téléphone", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  // Compte de démonstration (les inscriptions sont limitées à 5 par adresse et par 10 minutes)
  expect((await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } })).ok()).toBeTruthy();
  await page.goto("/pos/reservations");
  await page.getByTestId("new-reservation").click();
  const dialog = page.getByRole("dialog", { name: "Nouvelle réservation" });
  await dialog.getByLabel("Nom").fill("Famille Wong");
  await dialog.getByRole("radio", { name: "6" }).click();
  await dialog.getByRole("button", { name: /Dem\./ }).click();
  await dialog.getByRole("button", { name: /^12:00/ }).click();
  await page.screenshot({ path: test.info().outputPath("reservation-phone.png") });
  await page.getByRole("button", { name: "Enregistrer la réservation" }).click();
  await expect(page.getByTestId("booking-done")).toContainText("une table pour 6 demain à 12 h.");
  await ctx.close();
});
