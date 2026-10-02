import { test, expect } from "@playwright/test";

/** Catalogue : la TVA se change directement dans la liste, ou d'un coup pour les produits affichés. */
test("TVA modifiable dans le catalogue, produit par produit ou en masse", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  await page.goto("/admin/catalog/products");
  await page.getByPlaceholder("Rechercher…").fill("Poisson cru au lait de coco");
  const select = page.getByLabel("TVA de Poisson cru au lait de coco");
  const before = await select.inputValue();
  const options = await select.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  const other = options.find((v) => v !== before)!;
  await select.selectOption(other);
  await expect(page.getByText(/TVA de « Poisson cru au lait de coco » modifiée/)).toBeVisible();
  await expect(select).toHaveValue(other);

  // En masse : les produits affichés (ici, le seul produit filtré) reprennent leur taux d'origine
  await page.getByRole("button", { name: "% Changer la TVA" }).click();
  const dialog = page.getByTestId("bulk-tax");
  await expect(dialog).toContainText("Les produits affichés (1)");
  await page.getByLabel("Nouveau taux").selectOption(before);
  await page.getByRole("button", { name: "Appliquer à 1 produit" }).click();
  await expect(page.getByText("TVA modifiée sur 1 produit")).toBeVisible();
  await expect(select).toHaveValue(before);
});
