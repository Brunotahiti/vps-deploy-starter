import { test, expect, devices } from "@playwright/test";

test.use({ viewport: devices["iPhone 13"].viewport, userAgent: devices["iPhone 13"].userAgent, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

/** Téléphone : les menus de l'administration et de la caisse s'ouvrent du même côté (gauche) et la croix les ferme. */
test("menus du téléphone : même côté, fermeture par la croix", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });

  await page.goto("/admin");
  // Bouton « Menu » en tuile, comme la barre des portails ; dans la gestion, il clignote trois fois à l'arrivée
  const adminBtn = page.getByTestId("menu-button").locator("visible=true");
  await expect(adminBtn).toHaveClass(/menu-blink/);
  expect(await adminBtn.evaluate((el) => getComputedStyle(el).animationIterationCount)).toBe("3");
  expect((await adminBtn.boundingBox())!.height).toBe(56);
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  const adminClose = page.getByRole("button", { name: "Fermer le menu" }).last();
  await expect(adminClose).toBeVisible();
  const adminMenu = (await adminClose.locator("xpath=ancestor::aside").boundingBox())!;
  expect(adminMenu.x).toBeLessThan(5);
  await adminClose.tap();
  await expect(adminClose).toBeHidden();

  await page.goto("/pos");
  await expect(page.getByTestId("menu-button").locator("visible=true")).not.toHaveClass(/menu-blink/);
  // Retour dans la gestion par la barre des portails : il clignote de nouveau
  await page.getByTestId("portal-dock").locator("visible=true").getByRole("link", { name: "Gestion" }).tap();
  await expect(page.getByTestId("menu-button").locator("visible=true")).toHaveClass(/menu-blink/);
  await page.goto("/pos");
  await page.getByRole("button", { name: "Ouvrir le menu" }).tap();
  const posMenu = page.getByRole("dialog", { name: "Menu" });
  await expect(posMenu).toBeVisible();
  await page.waitForTimeout(400); // fin de l'animation d'ouverture
  expect((await posMenu.boundingBox())!.x).toBeLessThan(5);
  await posMenu.getByRole("button", { name: "Fermer le menu" }).tap();
  await expect(page.locator('[aria-hidden="true"] [role="dialog"][aria-label="Menu"]')).toHaveCount(1);
});

/** Téléphone : la barre Salle / Caisse / Cuisine reste visible en bas de chaque écran, sans recouvrir le contenu. */
test("barre des portails toujours visible ; bandeau plein écran masquable", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  const height = page.viewportSize()!.height;
  for (const path of ["/admin", "/admin/reports", "/pos", "/pos/orders", "/pos/cash", "/kds"]) {
    await page.goto(path);
    const dock = page.getByTestId("portal-dock").locator("visible=true");
    await expect(dock, path).toHaveCount(1);
    const box = (await dock.boundingBox())!;
    expect(box.y + box.height, path).toBeGreaterThan(height - 40);
    expect(box.y + box.height, path).toBeLessThanOrEqual(height);
    await expect(dock.getByRole("link", { name: "Cuisine" })).toBeVisible();
  }

  // Ouvert dans Safari (pas depuis l'icône de l'écran d'accueil) : proposition d'installer pour le plein écran
  await page.goto("/admin");
  const banner = page.getByTestId("install-banner");
  await expect(banner).toBeVisible();
  await banner.getByRole("button", { name: "Installer" }).tap();
  await expect(page.getByText("« Sur l'écran d'accueil »")).toBeVisible(); // guide iPhone affiché d'emblée
  await page.keyboard.press("Escape");
  await banner.getByRole("button", { name: "Masquer" }).tap();
  await expect(banner).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("portal-dock").locator("visible=true")).toHaveCount(1);
  await expect(page.getByTestId("install-banner")).toHaveCount(0);
});

/** Menu de l'administration : tableau de bord + rubriques repliables ; la rubrique de la page ouverte est dépliée. */
test("menu simplifié : rubriques repliables", async ({ page }) => {
  await page.request.post("/api/auth/login", { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  await page.goto("/admin/users");
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  const menu = page.getByRole("navigation", { name: "Menu" }).last();
  for (const g of ["Ventes", "Carte & stocks", "Salle & clients", "Équipe", "Réglages"]) await expect(menu.getByRole("button", { name: g })).toBeVisible();
  // Page ouverte : sa rubrique est dépliée, les autres repliées
  await expect(menu.getByRole("button", { name: "Équipe" })).toHaveAttribute("aria-expanded", "true");
  await expect(menu.getByRole("link", { name: "Accès & PIN" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "Commandes" })).toHaveCount(0);
  // Une seule rubrique ouverte à la fois
  await menu.getByRole("button", { name: "Ventes" }).tap();
  await expect(menu.getByRole("button", { name: "Équipe" })).toHaveAttribute("aria-expanded", "false");
  await menu.getByRole("link", { name: "Statistiques" }).tap();
  await page.waitForURL(/\/admin\/stats$/);
});
