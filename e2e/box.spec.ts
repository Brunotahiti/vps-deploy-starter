import { test, expect } from "@playwright/test";

/** Boîtier de secours : clé créée depuis Admin → Imprimantes, copie du restaurant téléchargée avec elle, boîtier retiré. */
test("ajouter un boîtier de secours : la clé télécharge la copie du restaurant, puis ne marche plus une fois retiré", async ({ page, request }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("demo@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);

  await page.goto("/admin/hardware");
  const section = page.getByTestId("local-boxes");
  await section.getByRole("button", { name: "Ajouter un boîtier" }).click();
  const name = `Boîtier e2e ${Date.now()}`; // nom unique : indépendant des boîtiers laissés par d'autres tests
  await page.getByRole("dialog").getByRole("textbox").fill(name);
  await page.getByRole("button", { name: "Créer la clé du boîtier" }).click();
  const key = (await page.getByTestId("box-key").textContent())!.trim();
  expect(key).toMatch(/^mrbox_/);
  await page.screenshot({ path: test.info().outputPath("cle-boitier.png") });
  await page.getByRole("button", { name: "J'ai copié la clé" }).click();

  const card = section.getByTestId("box-card").filter({ hasText: name });
  await expect(card).toContainText("Pas encore installé");

  const snap = await request.get("/api/box/snapshot", { headers: { authorization: `Bearer ${key}`, "x-box-lan-ip": "192.168.1.30", "x-box-version": "1.0.0" } });
  expect(snap.status()).toBe(200);
  const data = (await snap.json()).data;
  expect(data.format).toBe(1);
  expect(data.tables.products.length).toBeGreaterThan(5);
  expect(data.tables.users.length).toBeGreaterThan(0);

  await page.reload();
  await expect(card).toContainText("Copie à jour");
  await expect(card).toContainText("Adresse locale 192.168.1.30");
  await page.screenshot({ path: test.info().outputPath("boitier-en-ligne.png"), fullPage: true });

  page.once("dialog", (d) => d.accept());
  await card.getByRole("button", { name: "Retirer" }).click();
  await expect(card).toHaveCount(0);
  expect((await request.get("/api/box/snapshot", { headers: { authorization: `Bearer ${key}` } })).status()).toBe(401);
});
