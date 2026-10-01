import { test, expect } from "@playwright/test";

/** Phase 3 : le cuisinier accepte, prépare et marque prêt un ticket ; la salle voit le plat prêt. */
test("écran cuisine : accepter → en préparation → prêt → terminé", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);

  // Crée une commande comptoir et l'envoie : un ticket NOUVEAU apparaît
  const catalog = await (await page.request.get("/api/pos/catalog")).json();
  const product = catalog.data.products.find((p: { name: string }) => p.name === "Eau minérale 50 cl");
  const created = await (await page.request.post("/api/orders", { data: { type: "COUNTER", customerName: "Test KDS" } })).json();
  await page.request.post(`/api/orders/${created.data.id}/items`, { data: { productId: product.id, quantity: 2 } });
  await page.request.post(`/api/orders/${created.data.id}/send`, { data: { all: true } });

  await page.goto("/kds");
  // Le ticket de CETTE commande (des tests précédents peuvent avoir laissé d'autres tickets « Test KDS »)
  const num = String(created.data.number).split("-").pop();
  const card = page.locator("article", { hasText: "Test KDS" }).filter({ hasText: `n° ${num}` }).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("2 × Eau minérale 50 cl")).toBeVisible();
  await card.getByRole("button", { name: /^ACCEPTER/ }).click();
  await expect(card.getByRole("button", { name: /^EN PRÉPARATION/ })).toBeVisible();
  await card.getByRole("button", { name: /^EN PRÉPARATION/ }).click();
  await expect(card.getByRole("button", { name: /^PRÊT/ })).toBeVisible();
  await card.getByRole("button", { name: /^PRÊT/ }).click();

  // Le ticket passe dans « Prêts » ; la commande voit l'article prêt
  await page.getByRole("button", { name: /Prêts/ }).click();
  const ready = page.locator("article", { hasText: "Test KDS" }).filter({ hasText: `n° ${num}` }).first();
  await expect(ready).toBeVisible();
  const itemStatus = async () => (await (await page.request.get(`/api/orders/${created.data.id}`)).json()).data.items[0].status;
  await expect.poll(itemStatus).toBe("READY");
  await ready.getByRole("button", { name: /^TERMINÉ/ }).click();
  await expect(ready).toBeHidden();
  await expect.poll(itemStatus).toBe("SERVED");

  // Bon cuisine imprimable
  const tickets = await (await page.request.get("/api/kitchen/tickets?includeDone=1")).json();
  const mine = tickets.data.find((t: { order: { id: string } }) => t.order.id === created.data.id);
  const html = await (await page.request.get(`/api/kitchen/tickets/${mine.id}/print?format=html`)).text();
  expect(html).toContain("Eau minérale 50 cl");
  await page.request.post(`/api/orders/${created.data.id}/cancel`, { data: { reason: "Test / formation" } });
});

test("le rôle cuisine arrive directement sur l'écran cuisine", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("cuisine@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/kds/);
  await expect(page.getByRole("button", { name: /^Tous/ })).toBeVisible();
});

/** Portail cuisine : une tablette enregistrée « Écran cuisine » ouvre sur le PIN, puis directement sur les tickets. */
test("portail cuisine : tablette cuisine, PIN incorrect puis connexion", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  expect((await page.request.post("/api/auth/terminal/register", { data: { name: "Tablette passe", kind: "KDS" } })).ok()).toBe(true);
  await page.request.post("/api/auth/logout");

  // L'accueil d'une tablette cuisine mène au portail
  await page.goto("/");
  await page.waitForURL(/\/kds\/login/);
  const portal = page.getByTestId("portal-cuisine");
  await expect(portal.getByText("Terminal · Tablette passe")).toBeVisible();

  // PIN incorrect (clavier physique) : message d'erreur, saisie remise à zéro
  await page.keyboard.type("9999");
  await page.keyboard.press("Enter");
  await expect(portal.getByRole("alert")).toBeVisible();

  // PIN du cuisinier au pavé tactile : accueil puis tickets
  for (const d of "3000") await portal.getByRole("button", { name: d, exact: true }).click();
  await portal.getByRole("button", { name: "Entrer en cuisine" }).click();
  await expect(page.getByTestId("welcome-splash")).toBeVisible();
  await page.waitForURL(/\/kds$/);
  await expect(page.getByRole("button", { name: /En cours/ })).toBeVisible();

  // Changer d'utilisateur ramène au portail
  await page.getByTitle("Changer d'utilisateur").click();
  await page.waitForURL(/\/kds\/login/);
});

/** Portails salle et caisse : passage de l'un à l'autre, l'appareil revient sur le dernier portail utilisé. */
test("portails : salle, caisse et cuisine sur un terminal", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);

  // Menu de l'administration : un bouton par portail, qui ouvre l'écran de l'équipe
  await page.goto("/admin");
  const portals = page.getByRole("navigation", { name: "Portails" }).first();
  await portals.getByRole("link", { name: "Cuisine" }).click();
  await page.waitForURL(/\/kds$/);

  expect((await page.request.post("/api/auth/terminal/register", { data: { name: "Tablette salle", kind: "POS" } })).ok()).toBe(true);
  await page.request.post("/api/auth/logout");

  await page.goto("/salle");
  await expect(page.getByTestId("portal-salle")).toBeVisible();
  await page.getByRole("navigation", { name: "Choisir le portail" }).getByRole("link", { name: "Caisse" }).click();
  await expect(page.getByTestId("portal-caisse")).toBeVisible();
  await page.getByRole("navigation", { name: "Choisir le portail" }).getByRole("link", { name: "Salle" }).click();
  await expect(page.getByTestId("portal-salle")).toBeVisible();

  // Le serveur se connecte en salle : plan de salle ; après « Changer d'utilisateur », retour au portail Salle
  for (const d of "1001") await page.getByTestId("portal-salle").getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "Prendre le service" }).click();
  await page.waitForURL(/\/pos$/);
  await page.request.post("/api/auth/logout");
  await page.goto("/pos/login");
  await page.waitForURL(/\/salle/);
  await expect(page.getByTestId("portal-salle")).toBeVisible();
});
