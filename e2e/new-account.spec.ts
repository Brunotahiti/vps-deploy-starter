import { test, expect } from "@playwright/test";

/** Un restaurant qui vient de s'inscrire (aucune caisse ouverte) parcourt la caisse sans plantage — régression MANARESTO-1. */
test("nouveau compte : caisse, réservations et caisse enregistreuse s'ouvrent sans caisse ouverte", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const stamp = Date.now();
  const res = await page.request.post("/api/auth/signup", { data: { organizationName: `Roulotte ${stamp}`, establishmentName: "Roulotte du port", firstName: "Hina", lastName: "Test", email: `hina${stamp}@test.pf`, password: "motdepasse1" } });
  expect(res.ok()).toBeTruthy();
  const cash = await (await page.request.get("/api/cash/current")).json();
  expect(cash.data).toBeNull();
  for (const path of ["/pos", "/pos/reservations", "/pos/cash", "/pos/orders"]) {
    await page.goto(path);
    await expect(page.getByText(/Une erreur est survenue/)).toHaveCount(0);
    await page.waitForTimeout(800);
  }
  await page.goto("/pos/cash");
  await expect(page.getByRole("button", { name: /Ouvrir la caisse/ }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
