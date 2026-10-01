import { test, expect, type Page } from "@playwright/test";

/** Lit une entrée de la base locale de l'application (IndexedDB « manaresto », magasin « cache »). */
const idbHas = (key: string) => new Promise<boolean>((resolve) => {
  const req = indexedDB.open("manaresto");
  req.onerror = () => resolve(false);
  req.onsuccess = () => {
    try {
      const get = req.result.transaction("cache").objectStore("cache").get(key);
      get.onsuccess = () => resolve(!!get.result);
      get.onerror = () => resolve(false);
    } catch { resolve(false); }
  };
});

/** La tablette est prête pour une coupure : écrans enregistrés (le dernier est l'écran de commande) et catalogue gardé. */
async function offlineReady(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15000 });
  await expect.poll(() => page.evaluate(async () => {
    for (const name of await caches.keys()) if (await (await caches.open(name)).match("/pos/order/__shell__")) return true;
    return false;
  }), { timeout: 30000 }).toBe(true);
  await expect.poll(() => page.evaluate(idbHas, "pos-catalog"), { timeout: 20000 }).toBe(true);
}

/**
 * Mode hors ligne (PWA) : la caisse continue de fonctionner sans réseau et se
 * synchronise à la reconnexion sans dupliquer les opérations.
 * Nécessite un build de production (service worker actif).
 */
test("hors ligne : ouvrir une table, commander, envoyer, puis synchroniser", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  await page.goto("/pos");
  await expect(page.locator("header [data-testid=network-status][data-online=true]")).toBeVisible();
  // Laisser le service worker enregistrer les écrans et le catalogue se mettre en cache
  await offlineReady(page);
  const freeBefore = page.locator("button[title='Libre']:visible").first();
  const tableName = (await freeBefore.getByTestId("table-name").textContent())?.trim();

  // ---- Coupure réseau
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator("header [data-testid=network-status][data-online=false]")).toBeVisible();

  await page.locator("button[title='Libre']:visible").first().click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.waitForURL(/\/pos\/order\//);
  const orderId = page.url().split("/pos/order/")[1];
  await expect(page.getByText("hors ligne", { exact: false }).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByTestId("ticket").getByText(`Table ${tableName}`)).toBeVisible();

  await page.getByRole("button", { name: "Boissons" }).click();
  const grid = page.locator("section").first();
  await grid.getByRole("button", { name: "Ajouter Coca-Cola 33 cl" }).click();
  await grid.getByRole("button", { name: "Ajouter Coca-Cola 33 cl" }).click();
  await expect(page.getByTestId("ticket").getByText("Coca-Cola 33 cl")).toHaveCount(2);
  await expect(page.getByTestId("ticket").getByText("900 F").first()).toBeVisible();

  await page.getByRole("button", { name: /Envoyer/ }).click();
  await page.getByRole("button", { name: "Tout envoyer" }).click();
  await expect(page.getByTestId("ticket").getByText("envoyé").first()).toBeVisible();
  await expect(page.locator("header [data-testid=network-status]")).toHaveAttribute("aria-label", /à synchroniser/);

  // Retour salle hors ligne : la table apparaît occupée grâce à la commande locale
  await page.getByRole("button", { name: "Salle" }).first().click();
  await page.waitForURL(/\/pos$/);
  await expect(page.locator(`button[title='Commande en cours']:visible`).filter({ hasText: tableName! })).toBeVisible();

  // ---- Reconnexion : synchronisation
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(/Synchronisation : 4 opérations transmises/)).toBeVisible({ timeout: 15000 });
  await expect(page.locator("header [data-testid=network-status][data-online=true]")).toBeVisible();

  const res = await page.request.get(`/api/orders/${orderId}`);
  expect(res.ok()).toBe(true);
  const order = (await res.json()).data;
  expect(order.status).toBe("SENT");
  expect(order.items.length).toBe(2);
  expect(order.items.every((i: { status: string }) => i.status === "SENT")).toBe(true);
  expect(order.total).toBe(900);
  expect(order.courses.length).toBe(4);

  // Nettoyage : annuler la commande de test
  await page.request.post(`/api/orders/${orderId}/cancel`, { data: { reason: "test hors ligne" } });
});

/** Table ouverte hors ligne alors qu'un autre appareil l'a ouverte entre-temps : rien n'est perdu, tout rejoint la même commande. */
test("hors ligne : table ouverte en même temps sur un autre appareil, articles regroupés", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  await page.goto("/pos");
  await expect(page.locator("header [data-testid=network-status][data-online=true]")).toBeVisible();
  await offlineReady(page);
  const free = page.locator("button[title='Libre']:visible").first();
  const tableName = (await free.getByTestId("table-name").textContent())?.trim();
  const floor = (await (await page.request.get("/api/floor")).json()).data as { rooms: { tables: { id: string; name: string }[] }[] };
  const tableId = floor.rooms.flatMap((r) => r.tables).find((t) => t.name === tableName)!.id;
  const catalog = (await (await page.request.get("/api/pos/catalog")).json()).data as { products: { id: string; name: string }[] };
  const biere = catalog.products.find((p) => p.name.startsWith("Hinano"))!;

  // ---- Cet appareil perd le réseau et ouvre la table
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.locator("button[title='Libre']:visible").first().click();
  await page.getByRole("button", { name: "2", exact: true }).click();
  await page.waitForURL(/\/pos\/order\//);
  const localId = page.url().split("/pos/order/")[1];
  await page.getByRole("button", { name: "Boissons" }).click();
  await page.locator("section").first().getByRole("button", { name: "Ajouter Coca-Cola 33 cl" }).click();
  await expect(page.getByTestId("ticket").getByText("Coca-Cola 33 cl")).toHaveCount(1);

  // ---- Pendant ce temps, un autre appareil (toujours en ligne) ouvre la même table et commande une bière
  const other = (await (await page.request.post("/api/orders", { data: { type: "DINE_IN", tableId, covers: 3 } })).json()).data as { id: string };
  expect(other.id).not.toBe(localId);
  expect((await page.request.post(`/api/orders/${other.id}/items`, { data: { productId: biere.id, quantity: 1 } })).ok()).toBe(true);

  // ---- Retour du réseau : le Coca saisi hors ligne rejoint la commande de l'autre appareil
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByText(/déjà ouverte sur un autre appareil/)).toBeVisible({ timeout: 15000 });
  await page.waitForURL(new RegExp(`/pos/order/${other.id}`));
  const merged = (await (await page.request.get(`/api/orders/${other.id}`)).json()).data as { items: { name: string; status: string }[] };
  expect(merged.items.map((i) => i.name).sort()).toEqual(["Coca-Cola 33 cl", biere.name].sort());
  expect((await page.request.get(`/api/orders/${localId}`)).status()).toBe(404);

  await page.request.post(`/api/orders/${other.id}/cancel`, { data: { reason: "test hors ligne" } });
});

/**
 * Coupure d'internet avec une tablette qui n'a jamais ouvert cette table : l'application démarre à froid
 * sans réseau, la commande prise sur un autre appareil est là, on encaisse en espèces, la table se libère ;
 * au retour du réseau, le paiement est transmis.
 */
test("hors ligne : démarrage à froid, encaissement espèces d'une table ouverte ailleurs", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  await page.goto("/pos");
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15000 });
  if (!(await (await page.request.get("/api/cash/current")).json()).data) await page.request.post("/api/cash/open", { data: { openingFloat: 0 } });

  // Un autre appareil ouvre une table libre et commande deux Coca
  const floor = (await (await page.request.get("/api/floor")).json()).data as { rooms: { tables: { id: string; name: string; status: string }[] }[] };
  const table = floor.rooms.flatMap((r) => r.tables).find((t) => t.status === "FREE")!;
  const catalog = (await (await page.request.get("/api/pos/catalog")).json()).data as { products: { id: string; name: string }[] };
  const coca = catalog.products.find((p) => p.name === "Coca-Cola 33 cl")!;
  const order = (await (await page.request.post("/api/orders", { data: { type: "DINE_IN", tableId: table.id, covers: 2 } })).json()).data as { id: string };
  await page.request.post(`/api/orders/${order.id}/items`, { data: { productId: coca.id, quantity: 2 } });

  // Cette tablette tient sa copie à jour en ligne : écrans de l'application et commandes en cours
  await page.reload();
  await expect.poll(() => page.evaluate(async () => {
    for (const name of await caches.keys()) if (await (await caches.open(name)).match("/pos/order/__shell__")) return true;
    return false;
  }), { timeout: 20000 }).toBe(true);
  await expect.poll(() => page.evaluate(idbHas, `order:${order.id}`), { timeout: 20000 }).toBe(true);

  // ---- Coupure d'internet, puis l'application est rouverte (démarrage à froid)
  await context.setOffline(true);
  await page.close();
  const tab = await context.newPage();
  await tab.goto(`/pos/order/${order.id}`);
  await expect(tab.getByTestId("ticket").getByText("Coca-Cola 33 cl")).toBeVisible({ timeout: 15000 });
  await tab.evaluate(() => window.dispatchEvent(new Event("offline")));

  await tab.getByRole("button", { name: /Payer/ }).click();
  await tab.getByRole("button", { name: "Espèces", exact: true }).click();
  await tab.getByRole("button", { name: /Encaisser/ }).click();
  await expect(tab.getByRole("heading", { name: "Commande soldée" })).toBeVisible();
  await tab.getByRole("button", { name: "Terminer" }).click();
  await tab.waitForURL(/\/pos$/);
  // La table est libérée sur le plan, sans réseau
  await expect(tab.locator("button:visible").filter({ has: tab.getByTestId("table-name").getByText(table.name, { exact: true }) }).first()).not.toHaveAttribute("title", /Commande|Occupée|envoyés|Addition/);

  // ---- Retour du réseau : le paiement est transmis
  await context.setOffline(false);
  await tab.evaluate(() => window.dispatchEvent(new Event("online")));
  const fetchOrder = async () => (await (await tab.request.get(`/api/orders/${order.id}`)).json()).data as { status: string; payments: { method: string }[] };
  await expect.poll(async () => (await fetchOrder()).status, { timeout: 30000 }).toBe("PAID");
  const paid = await fetchOrder();
  expect(paid.payments.map((p) => p.method)).toEqual(["CASH"]);
});

/**
 * Coupure d'internet sur une tablette enregistrée : changement d'utilisateur, connexion par PIN sans réseau,
 * remise autorisée par le PIN du manager vérifié sur la tablette ; au retour du réseau, tout est transmis
 * au nom de qui l'a fait (serveuse) et de qui l'a autorisé (manager).
 */
test("hors ligne : connexion par PIN et remise autorisée par le PIN du manager", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  expect((await page.request.post("/api/auth/terminal/register", { data: { name: "Tablette coupure", kind: "POS" } })).ok()).toBe(true);
  // Une table avec deux Coca, ouverte en ligne
  const floor = (await (await page.request.get("/api/floor")).json()).data as { rooms: { tables: { id: string; name: string; status: string }[] }[] };
  const table = floor.rooms.flatMap((r) => r.tables).find((t) => t.status === "FREE")!;
  const catalog = (await (await page.request.get("/api/pos/catalog")).json()).data as { products: { id: string; name: string }[] };
  const coca = catalog.products.find((p) => p.name === "Coca-Cola 33 cl")!;
  const order = (await (await page.request.post("/api/orders", { data: { type: "DINE_IN", tableId: table.id, covers: 2 } })).json()).data as { id: string };
  await page.request.post(`/api/orders/${order.id}/items`, { data: { productId: coca.id, quantity: 2 } });

  // Moana prend son service en ligne : la tablette garde les écrans, la commande et les laissez-passer
  await page.request.post("/api/auth/logout");
  await page.goto("/salle");
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15000 });
  for (const d of "1001") await page.getByTestId("portal-salle").getByRole("button", { name: d, exact: true }).click();
  await page.getByRole("button", { name: "Prendre le service" }).click();
  await page.waitForURL(/\/pos$/);
  await expect.poll(() => page.evaluate(idbHas, "offline-passes"), { timeout: 20000 }).toBe(true);
  await expect.poll(() => page.evaluate(idbHas, `order:${order.id}`), { timeout: 20000 }).toBe(true);
  await offlineReady(page);

  // ---- Coupure : Moana passe la main, Vaiana entre avec son PIN sans réseau
  // (setOffline ne coupe pas le service worker : toutes les requêtes sont aussi refusées)
  await context.route("**/*", (r) => r.abort("internetdisconnected"));
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByTitle("Changer d'utilisateur").first().click();
  await page.waitForURL(/\/(salle|pos\/login)/);
  const portal = page.locator("[data-testid^=portal-]");
  for (const d of "1002") await portal.getByRole("button", { name: d, exact: true }).click();
  await portal.getByRole("button", { name: /Prendre le service|Ouvrir la caisse|Entrer/ }).click();
  await page.waitForURL(/\/pos$/, { timeout: 20000 });
  await expect(page.getByRole("button", { name: "V", exact: true })).toBeVisible(); // Vaiana, connectée sans réseau

  // Remise de 10 % : Vaiana n'en a pas le droit, Hinatea (manager) saisit son PIN, vérifié sur la tablette
  await page.goto(`/pos/order/${order.id}`);
  await expect(page.getByTestId("ticket").getByText("Coca-Cola 33 cl")).toBeVisible();
  await page.getByRole("button", { name: "Remise" }).click();
  await page.getByRole("button", { name: "10 %" }).click();
  await page.getByPlaceholder("Motif (obligatoire)").fill("Fidélité");
  await page.getByRole("button", { name: "Appliquer" }).click();
  const pinDialog = page.getByRole("dialog", { name: "Autorisation manager" });
  // PIN inconnu : refusé sur la tablette, la fenêtre reste ouverte
  for (const d of "9876") await pinDialog.getByRole("button", { name: d, exact: true }).click();
  await pinDialog.getByRole("button", { name: "Autoriser" }).click();
  await expect(pinDialog.getByText(/PIN manager incorrect/)).toBeVisible({ timeout: 15000 });
  // Le PIN du manager ouvre son laissez-passer
  for (const d of "2000") await pinDialog.getByRole("button", { name: d, exact: true }).click();
  await pinDialog.getByRole("button", { name: "Autoriser" }).click();
  await expect(pinDialog).toBeHidden({ timeout: 15000 });
  await expect(page.getByTestId("ticket").getByText(/Remise/).first()).toBeVisible();

  // ---- Retour du réseau : session de Vaiana, opérations transmises à leur nom
  await context.unrouteAll();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  // Pendant la reconnexion (fin de la session de Moana, ouverture de celle de Vaiana), une lecture peut être refusée
  const fetchOrder = async () => (await (await page.request.get(`/api/orders/${order.id}`)).json()).data as { discountTotal: number; subtotal: number; discountReason: string } | undefined;
  let synced: Awaited<ReturnType<typeof fetchOrder>>;
  await expect.poll(async () => { const o = await fetchOrder(); if (o) synced = o; return o?.discountTotal ?? 0; }, { timeout: 30000 }).toBeGreaterThan(0);
  synced = synced!;
  expect(synced.discountTotal).toBe(Math.round(synced.subtotal / 10));
  expect(synced.discountReason).toBe("Fidélité");

  await page.request.post("/api/auth/login", { data: { email: "manager@manaresto.pf", password: "demo1234" } });
  const audit = (await (await page.request.get("/api/audit?action=order.discount&take=5")).json()).data as { items: { entityId: string; user: { firstName: string } | null; authorizedById: string | null }[] };
  const entry = audit.items.find((a) => a.entityId === order.id)!;
  expect(entry.user?.firstName).toBe("Vaiana");
  expect(entry.authorizedById).not.toBeNull();
  await page.request.post(`/api/orders/${order.id}/cancel`, { data: { reason: "test hors ligne" } });
});
