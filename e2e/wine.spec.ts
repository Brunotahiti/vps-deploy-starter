import { test, expect } from "@playwright/test";

/** Option Cave à vin : fiche créée, prix fixés, réception, accord proposé à la caisse, verre servi d'une bouteille ouverte. */
test("cave à vin : fiche, formats, réception, accord à la caisse, vin au verre", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "manager@manaresto.pf", password: "demo1234" } });
  const name = `Cuvée e2e ${Date.now().toString().slice(-5)}`;
  let wineId: string | null = null;
  try {
    // Gestion → Cave à vin : nouvelle fiche avec un plat conseillé
    await page.goto("/admin/wine");
    if (await page.getByTestId("pending-later").count()) await page.getByTestId("pending-later").click();
    await page.getByTestId("wine-add").click();
    await page.getByTestId("wine-producer").fill("Domaine Test");
    await page.getByTestId("wine-name").fill(name);
    await page.getByTestId("wine-vintage").fill("2020");
    await page.getByTestId("wine-location").fill("Casier e2e");
    await page.getByTestId("dish-search").fill("Salade tahit");
    await page.getByRole("button", { name: "Salade tahitienne" }).click();
    await page.getByTestId("wine-save").click();
    await expect(page.getByTestId("wine-sheet")).toBeVisible();
    wineId = ((await (await page.request.get("/api/wine")).json()).data as { id: string; name: string }[]).find((w) => w.name === name)!.id;

    // Formats et prix : bouteille et verre, dans la catégorie « Vins »
    await page.getByTestId("wine-formats").click();
    await page.getByTestId("formats-category").selectOption({ label: "Vins" });
    await page.getByTestId("format-bottle").locator("button").first().click();
    await page.getByLabel("Prix Bouteille").fill("6000");
    await page.getByTestId("format-glass").locator("button").first().click();
    await page.getByLabel("Prix Verre").fill("1200");
    await page.getByTestId("formats-save").click();
    await expect(page.getByTestId("wine-sheet")).toContainText("Verre 12 cl");

    // Réception de 6 bouteilles
    await page.getByTestId("wine-receive").click();
    await page.getByTestId("receive-bottles").fill("6");
    await page.getByTestId("receive-save").click();
    await expect(page.getByTestId("sheet-bottles")).toHaveText("6 bout.");
    await page.keyboard.press("Escape");

    // Caisse : la salade appelle l'accord, le verre s'ajoute d'un geste puis part au bar
    const order = (await (await page.request.post("/api/orders", { data: { type: "COUNTER" } })).json()).data as { id: string };
    await page.goto(`/pos/order/${order.id}`);
    if (await page.getByTestId("pending-later").count()) await page.getByTestId("pending-later").click();
    await page.getByRole("button", { name: "Entrées" }).click();
    await page.getByRole("button", { name: "Ajouter Salade tahitienne" }).click();
    const strip = page.getByTestId("wine-pairings");
    await expect(strip).toContainText(name);
    await strip.getByRole("button", { name: new RegExp(`${name}.*verre`) }).click();
    await expect(page.getByTestId("ticket").getByText(`${name} 2020 · verre 12 cl`)).toBeVisible();
    await page.getByRole("button", { name: /Envoyer/ }).click();
    await expect(page.getByTestId("ticket").getByText("envoyé").first()).toBeVisible();

    // Vin au verre : la bouteille ouverte suit le verre servi (75 − 12 = 63 cl)
    await page.goto("/pos/wine");
    await page.getByRole("tab", { name: /Vin au verre/ }).click();
    const bottle = page.getByTestId("open-bottle").filter({ hasText: name });
    await expect(bottle).toContainText("63 cl");
    await bottle.getByTestId("open-discard").click();
    await page.getByTestId("discard-save").click();
    await expect(page.getByTestId("open-bottle").filter({ hasText: name })).toHaveCount(0);
    await page.request.post(`/api/orders/${order.id}/cancel`, { data: { reason: "Test e2e" } });
  } finally {
    if (wineId) await page.request.delete(`/api/wine/${wineId}`);
  }
});

/** L'équipe en salle consulte la cave et les accords, sans prix d'achat ni réglages. */
test("cave à vin : un serveur consulte sans voir les prix d'achat", async ({ request }) => {
  await request.post("/api/auth/login", { data: { email: "moana@manaresto.pf", password: "demo1234" } });
  const wines = (await (await request.get("/api/wine")).json()).data as { id: string; bottleCost: number; value: number }[];
  expect(wines.length).toBeGreaterThan(0);
  expect(wines.every((w) => w.bottleCost === 0 && w.value === 0)).toBe(true);
  const detail = (await (await request.get(`/api/wine/${wines[0].id}`)).json()).data as { bottleCost: number; movements: unknown[] };
  expect(detail).toMatchObject({ bottleCost: 0, movements: [] });
  expect((await request.put("/api/wine/settings", { data: { showOnSite: false } })).status()).toBe(403);
  expect((await request.post(`/api/wine/${wines[0].id}/receive`, { data: { bottles: 1 } })).status()).toBe(403);
  expect((await request.get("/api/wine/pairings")).ok()).toBe(true);
});
