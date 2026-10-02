import { test, expect, type Page } from "@playwright/test";

const field = (page: Page, label: string) => page.locator(`label:has(span:text-is("${label}"))`).locator("input, select, textarea").first();

/** Profils : le guide « Qui peut faire quoi ? », le choix d'un profil en carte et son badge dans la liste. */
test("créer un Chef en cuisine en choisissant son profil", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("demo@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);

  await page.goto("/admin/users");
  const guide = page.getByTestId("profiles-guide");
  for (const name of ["Admin", "Gérant", "Chef en cuisine", "Équipe en salle"]) await expect(guide.getByRole("heading", { name, exact: true })).toBeVisible();

  const tag = Date.now().toString(36);
  await page.getByRole("button", { name: "Nouvel utilisateur" }).click();
  await field(page, "Prénom").fill("Chef");
  await field(page, "Nom").fill(tag);
  await field(page, "Email").fill(`chef-${tag}@manaresto.pf`);
  await field(page, "Mot de passe (8 car. min.)").fill("password123");
  await field(page, "PIN caisse (4 à 6 chiffres)").fill(String(100000 + Math.floor(Math.random() * 900000)));
  // Équipe en salle par défaut ; on choisit le chef
  await expect(page.getByTestId("profile-server")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("profile-kitchen").click();
  await expect(page.getByTestId("profile-kitchen")).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  const row = page.locator("tr", { hasText: `chef-${tag}@manaresto.pf` });
  await expect(row).toBeVisible();
  await expect(row.getByText("Chef en cuisine")).toBeVisible();
  expect(errors).toEqual([]);
});
