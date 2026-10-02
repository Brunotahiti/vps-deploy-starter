import { test, expect } from "@playwright/test";

/** Les quatre portails (Salle, Caisse, Cuisine, Gestion) restent visibles en bas de chaque espace, sur grand écran aussi. */
test("barre des quatre portails sur toutes les pages, portail courant mis en évidence", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  const height = page.viewportSize()!.height;
  for (const [path, current] of [["/admin", "Gestion"], ["/admin/catalog/products", "Gestion"], ["/pos", "Salle"], ["/pos/orders", "Caisse"], ["/pos/cash", "Caisse"], ["/kds", "Cuisine"]] as const) {
    await page.goto(path);
    const dock = page.getByTestId("portal-dock").locator("visible=true");
    await expect(dock, path).toHaveCount(1);
    for (const name of ["Salle", "Caisse", "Cuisine", "Gestion"]) await expect(dock.getByRole("link", { name }), `${path} ${name}`).toBeVisible();
    await expect(dock.locator('[aria-current="page"]'), path).toHaveText(current);
    const box = (await dock.boundingBox())!;
    expect(box.y + box.height, path).toBeGreaterThan(height - 40);
    if (path === "/admin") await page.screenshot({ path: test.info().outputPath("portails-gestion.png") });
    if (path === "/pos") await page.screenshot({ path: test.info().outputPath("portails-salle.png") });
  }
  // Gestion ramène à l'administration depuis la cuisine
  await page.getByTestId("portal-dock").getByRole("link", { name: "Gestion" }).click();
  await page.waitForURL(/\/admin$/);
});
