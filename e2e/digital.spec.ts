import { test, expect } from "@playwright/test";

/** Phase 6 : QR à table (menu public), commande en ligne → suivi, acceptation en caisse. */
test("QR à table : menu public, appel serveur, commande en attente de validation", async ({ page, request }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  const qr = await (await page.request.get("/api/tables/qr")).json();
  const free = await (await page.request.get("/api/floor")).json();
  const table = free.data.rooms.flatMap((r: { tables: { id: string; order: unknown }[] }) => r.tables).find((t: { order: unknown }) => !t.order);
  const row = qr.data.find((t: { id: string }) => t.id === table.id);

  // Page publique (sans session) : menu + appel serveur
  const pub = await request.get(`/api/public/menu/${row.qrToken}`);
  expect(pub.ok()).toBeTruthy();
  const menu = await pub.json();
  expect(menu.data.mode).toBe("ORDER");
  expect(menu.data.catalog.products.length).toBeGreaterThan(10);
  await page.goto(`/m/${row.qrToken}`);
  await expect(page.getByRole("button", { name: /Appeler un serveur/ })).toBeVisible();
  await page.getByRole("button", { name: /Appeler un serveur/ }).click();
  await expect(page.getByText(/Un serveur arrive/)).toBeVisible();
  await page.getByRole("button", { name: /EN/ }).click();
  await expect(page.getByRole("button", { name: /Call a waiter|A waiter is on the way/ })).toBeVisible();
  await page.getByRole("button", { name: /FR/ }).click();
  await page.getByRole("button", { name: "Ajouter Eau minérale 50 cl" }).click();
  await page.getByRole("button", { name: /Envoyer la commande/ }).first().click();
  await expect(page.getByText("Commande envoyée !")).toBeVisible();
  const floor = await (await page.request.get("/api/floor")).json();
  const t = floor.data.rooms.flatMap((r: { tables: { id: string; order: { id: string } | null; callRequestedAt: string | null }[] }) => r.tables).find((x: { id: string }) => x.id === table.id);
  expect(t.order).not.toBeNull();
  expect(t.callRequestedAt).not.toBeNull();
  await page.request.post(`/api/orders/${t.order.id}/cancel`, { data: { reason: "Test / formation" } });
  await page.request.delete(`/api/tables/${table.id}/call`);
});

test("commande en ligne → suivi public → acceptation en caisse", async ({ page, request }) => {
  const shop = await (await request.get("/api/public/shop/demo-mana-beach/le-mana-beach")).json().catch(() => null);
  const org = shop ? "le-mana-beach" : null;
  expect(org).not.toBeNull();
  const product = shop.data.catalog.products.find((p: { name: string }) => p.name === "Eau minérale 50 cl");
  const created = await (await request.post("/api/public/shop/demo-mana-beach/le-mana-beach/order", { data: { id: crypto.randomUUID(), mode: "PICKUP", name: "Test E2E", phone: "87000000", when: "12:30", lines: [{ id: crypto.randomUUID(), productId: product.id, quantity: 2 }], lang: "fr" } })).json();
  expect(created.data.stage).toBe("RECEIVED");
  await page.goto(`/suivi/${created.data.publicToken}`);
  await expect(page.getByText(/Reçue, en attente d'acceptation/)).toBeVisible();
  await expect(page.getByText("2 × Eau minérale 50 cl")).toBeVisible();

  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  await page.goto("/pos/orders");
  await page.getByRole("button", { name: /En ligne & borne/ }).click();
  const card = page.locator(".card", { hasText: `n° ${created.data.number.split("-")[1]}` }).first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: /Accepter/ }).click();
  await expect(page.getByText("Commande acceptée et envoyée en cuisine")).toBeVisible();
  await expect.poll(async () => (await (await request.get(`/api/public/track/${created.data.publicToken}`)).json()).data.stage).toBe("ACCEPTED");
  await page.request.post(`/api/orders/${created.data.id}/cancel`, { data: { reason: "Test / formation" } });
});

/** Phase 10 : site public propre au restaurant, réglé depuis Digital. */
test("site du restaurant : page publique, menu, boutons, langue, réglages", async ({ page }) => {
  await page.goto("/site/demo-mana-beach/le-mana-beach");
  await expect(page.getByRole("heading", { level: 1, name: "Le Mana Beach" })).toBeVisible();
  await expect(page.getByText("Cuisine du lagon, les pieds dans le sable")).toBeVisible();
  await expect(page.getByTestId("site-order")).toHaveAttribute("href", /\/commander\/demo-mana-beach\/le-mana-beach$/);
  await expect(page.getByTestId("site-reserve")).toHaveAttribute("href", /\/reserver\/demo-mana-beach\/le-mana-beach$/);
  await expect(page.getByTestId("site-menu").getByText("Poisson cru au lait de coco").first()).toBeVisible();
  await expect(page.getByTestId("site-status")).toContainText(/Ouvert|Fermé/);
  await page.goto("/site/demo-mana-beach/le-mana-beach?lang=en");
  await expect(page.getByTestId("site-reserve")).toHaveText(/Book a table/);
  await expect(page.getByTestId("site-status")).toContainText(/Open|Closed/);

  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  await page.goto("/admin/digital");
  // Adresses publiques : cliquables, et bouton « Ouvrir » dans un nouvel onglet
  // (le site s'affiche à sa belle adresse de partage : manaresto.com/le-mana-beach en production, /r/le-mana-beach ici)
  await expect(page.getByRole("link", { name: "Ouvrir" }).first()).toHaveAttribute("href", /\/r\/le-mana-beach$/);
  await expect(page.getByRole("link", { name: /\/reserver\/demo-mana-beach\/le-mana-beach$/ })).toHaveAttribute("target", "_blank");
  await page.getByLabel("Accroche (une phrase)").fill("Nouvelle accroche e2e");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByText("Réglages enregistrés")).toBeVisible();
  await page.goto("/site/demo-mana-beach/le-mana-beach");
  await expect(page.getByText("Nouvelle accroche e2e")).toBeVisible();
  await page.request.patch("/api/digital/settings", { data: { site: { tagline: "Cuisine du lagon, les pieds dans le sable" } } });
  const off = await page.request.get("/api/public/site/demo-mana-beach/inexistant");
  expect(off.status()).toBe(404);
});

/** Lien « Essayer la démo » de l'e-mail de bienvenue : ouvre directement le restaurant d'exemple. */
test("lien de démo : /login?demo=1 connecte au compte d'exemple", async ({ page }) => {
  await page.goto("/login?demo=1");
  await page.waitForURL(/\/(pos|admin)/, { timeout: 20000 });
  const me = await (await page.request.get("/api/auth/me")).json();
  expect(me.data.user.email).toBe("demo@manaresto.pf");
});
