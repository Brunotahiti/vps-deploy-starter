import { test, expect, type Page } from "@playwright/test";

/** Champ de formulaire ManaResto par libellé exact (évite « Prénom » ≈ « Nom »). */
const field = (page: Page, label: string) => page.locator(`label:has(span:text-is("${label}"))`).locator("input, select, textarea").first();

/** Balayage du back-office : chaque page se charge sans erreur JS et les formulaires principaux fonctionnent. */
async function login(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("demo@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
}

test("toutes les pages se chargent sans erreur JavaScript", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await login(page);
  const pages = ["/admin", "/admin/catalog/products", "/admin/catalog/categories", "/admin/catalog/modifiers", "/admin/catalog/menus", "/admin/catalog/tax-rates", "/admin/catalog/import", "/admin/floor", "/admin/orders", "/admin/cash", "/admin/users", "/admin/settings", "/admin/audit", "/admin/establishments", "/admin/stock", "/admin/stock/inventory", "/admin/stock/recipes", "/admin/stock/suppliers", "/admin/stock/orders", "/admin/stock/report", "/admin/staff", "/admin/staff/shifts", "/admin/staff/entries", "/admin/staff/summary", "/admin/reports", "/admin/stats", "/admin/customers", "/admin/digital", "/admin/integrations", "/admin/organization", "/pos/reservations", "/onboarding", "/kds", "/pos/clock", "/pos", "/pos/orders", "/pos/cash"];
  for (const p of pages) {
    await page.goto(p);
    await expect(page.locator("body")).not.toContainText(/Application error|Unhandled/);
    await page.waitForLoadState("load");
    await page.waitForTimeout(800); // le flux SSE reste ouvert : pas de "networkidle"
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("catalogue : créer catégorie, groupe d'options, produit, formule et taux de TVA", async ({ page }) => {
  await login(page);
  const tag = Date.now().toString(36);
  await page.goto("/admin/catalog/tax-rates");
  await page.getByRole("button", { name: "Nouveau taux" }).click();
  await page.getByPlaceholder("TVA restauration").fill(`TVA test ${tag}`);
  await page.getByPlaceholder("13").fill("7,5");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(`TVA test ${tag}`)).toBeVisible();
  await expect(page.getByText("7,50 %").first()).toBeVisible();

  await page.goto("/admin/catalog/categories");
  await page.getByRole("button", { name: "Nouvelle catégorie" }).click();
  await field(page, "Nom").fill(`Cat ${tag}`);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(`Cat ${tag}`)).toBeVisible();

  await page.goto("/admin/catalog/modifiers");
  await page.getByRole("button", { name: "Nouveau groupe" }).click();
  await page.getByPlaceholder("Cuisson").fill(`Sauce ${tag}`);
  await page.getByPlaceholder("Nom").first().fill("Ketchup");
  await page.getByRole("button", { name: "+ Option" }).click();
  await page.getByPlaceholder("Nom").nth(1).fill("Mayo");
  await page.getByPlaceholder("Supplément").nth(1).fill("50");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(`Sauce ${tag}`)).toBeVisible();

  await page.goto("/admin/catalog/products");
  await page.getByRole("button", { name: "Nouveau produit" }).click();
  await field(page, "Nom").fill(`Produit ${tag}`);
  await field(page, "Prix TTC").fill("1250");
  await field(page, "Coût matière").fill("400");
  await field(page, "Catégorie").selectOption({ label: `Cat ${tag}` });
  await page.getByRole("button", { name: new RegExp(`Sauce ${tag}`) }).click();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(`Produit ${tag}`)).toBeVisible();
  await expect(page.getByText("1 250 F").first()).toBeVisible();

  await page.goto("/admin/catalog/menus");
  await page.getByRole("button", { name: "Nouvelle formule" }).click();
  await field(page, "Nom").fill(`Formule ${tag}`);
  await field(page, "Prix TTC").fill("2900");
  await page.getByRole("button", { name: "+ Ajouter des produits" }).first().click();
  await page.getByRole("button", { name: /Poisson cru au lait de coco/ }).click();
  await page.keyboard.press("Escape"); // ne ferme que le sélecteur, pas l'éditeur de formule
  await expect(page.getByRole("heading", { name: "Nouvelle formule" })).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(`Formule ${tag}`)).toBeVisible();

  // La caisse voit les nouveautés
  const cat = await (await page.request.get("/api/pos/catalog")).json();
  expect(cat.data.products.some((p: { name: string }) => p.name === `Produit ${tag}`)).toBe(true);
  expect(cat.data.menus.some((m: { name: string }) => m.name === `Formule ${tag}`)).toBe(true);
});

test("salle, utilisateurs, paramètres et import CSV", async ({ page }) => {
  await login(page);
  const tag = Date.now().toString(36).slice(-4);
  await page.goto("/admin/floor");
  await page.getByRole("button", { name: "Salle", exact: true }).click();
  await page.getByPlaceholder("Salle, Terrasse…").fill(`Bar ${tag}`);
  await page.getByRole("button", { name: "Enregistrer" }).last().click();
  await expect(page.getByRole("button", { name: new RegExp(`Bar ${tag}`) })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`Bar ${tag}`) }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByText("Table ajoutée")).toBeVisible();

  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Nouvel utilisateur" }).click();
  await field(page, "Prénom").fill("Test");
  await field(page, "Nom").fill(tag);
  await field(page, "Email").fill(`test-${tag}@manaresto.pf`);
  await field(page, "Mot de passe (8 car. min.)").fill("password123");
  await field(page, "PIN caisse (4 à 6 chiffres)").fill("7777");
  await page.locator("select").last().selectOption({ label: "Serveur" });
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText(`test-${tag}@manaresto.pf`)).toBeVisible();

  await page.goto("/admin/settings");
  await field(page, "Téléphone").fill("+689 40 00 00 00");
  await page.getByRole("button", { name: "Enregistrer" }).first().click();
  await expect(page.getByText("Paramètres enregistrés")).toBeVisible();

  await page.goto("/admin/catalog/import");
  await page.locator("textarea").fill(`Catégorie;Produit;Prix;TVA;Coût;Référence\nImport ${tag};Plat importé ${tag};1500;13;500;IMP-${tag}\nImport ${tag};Dessert importé ${tag};800;;200;IMP2-${tag}`);
  await page.getByRole("button", { name: "Détecter les colonnes" }).click();
  await page.getByRole("button", { name: /Importer 2 produits/ }).click();
  await expect(page.getByText(/2.*créés/)).toBeVisible();
});
