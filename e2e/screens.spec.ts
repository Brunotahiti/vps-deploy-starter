import { test, expect } from "@playwright/test";

/** Écran en salle : créé en gestion, la carte s'affiche à son adresse secrète, sans connexion. */
test("écran en salle : création, affichage sans connexion, plat du jour", async ({ page, browser }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  const name = `Écran test ${Date.now().toString(36)}`;
  await page.goto("/admin/screens");
  await page.getByTestId("screen-new").click();
  await page.getByLabel("Nom de l'écran").fill(name);
  await page.getByLabel("Titre de la mise en avant").fill("Happy hour");
  await page.getByLabel("Texte mis en avant").fill("Bières pression");
  await page.getByTestId("screen-save").click();
  const row = page.getByTestId("screen-row").filter({ hasText: name });
  await expect(row).toBeVisible();
  const href = await row.getByTestId("screen-open").getAttribute("href");

  // Télévision : navigateur sans session
  const tv = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  await tv.goto(href!);
  await expect(tv.getByTestId("menu-screen")).toBeVisible();
  await expect(tv.getByTestId("screen-headline")).toContainText("Happy hour");
  await expect(tv.getByTestId("screen-item").first()).toBeVisible();
  await tv.close();
  await page.reload();
  await expect(page.getByTestId("screen-row").filter({ hasText: name })).toContainText("Allumé");
});
