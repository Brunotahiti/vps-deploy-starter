import { test, expect, type APIRequestContext } from "@playwright/test";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Boîtier de secours, de bout en bout : vrai cloud (serveur de test), vraie application du boîtier sur sa propre base,
 * passerelle entre les deux, internet coupé puis rétabli.
 */
const CLOUD = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const BOX_APP_PORT = 3201, WAN_PORT = 3151, GATEWAY_PORT = 3301;
const BOX = `http://localhost:${GATEWAY_PORT}`;
const SECRET = "secret-du-boitier-e2e-0123456789";
const boxDbUrl = (process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/manaresto").replace(/\/manaresto(\?|$)/, "/manaresto_box_e2e$1");

/** « Internet » du boîtier : un relais TCP vers le cloud que le test coupe et rétablit. */
function wan() {
  const sockets = new Set<net.Socket>();
  const target = new URL(CLOUD);
  let server: net.Server | null = null;
  return {
    up: () => new Promise<void>((resolve) => {
      server = net.createServer((client) => {
        const up = net.connect(Number(target.port || 80), target.hostname);
        sockets.add(client); sockets.add(up);
        client.pipe(up).pipe(client);
        const end = () => { client.destroy(); up.destroy(); sockets.delete(client); sockets.delete(up); };
        client.on("error", end); up.on("error", end); client.on("close", end); up.on("close", end);
      });
      server.listen(WAN_PORT, "127.0.0.1", () => resolve());
    }),
    down: () => new Promise<void>((resolve) => { for (const s of sockets) s.destroy(); sockets.clear(); if (server) server.close(() => resolve()); else resolve(); server = null; }),
  };
}

async function waitFor(url: string, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} injoignable`);
}

async function loginDemo(request: APIRequestContext, base: string) {
  const r = await request.post(`${base}/api/auth/login`, { data: { email: "demo@manaresto.pf", password: "demo1234" } });
  expect(r.status()).toBe(200);
}

let boxApp: ChildProcess;
let gateway: ChildProcess;
let boxId = "";
type Status = { mode: string; pending: number; lastSync: string | null; lastSyncError: string | null; conflicts: unknown[] };
const status = async (): Promise<Status> => (await fetch(`${BOX}/__box/status`)).json();
const internet = wan();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "box-e2e-"));

test.beforeAll(async ({ playwright }) => {
  test.setTimeout(180_000);
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: boxDbUrl } });
  boxApp = spawn("pnpm", ["next", "start", "-p", String(BOX_APP_PORT)], { env: { ...process.env, DATABASE_URL: boxDbUrl, BOX_MODE: "1", BOX_SECRET: SECRET, PORT: String(BOX_APP_PORT), PUBLIC_URL: BOX, EMAIL_TRANSPORT: "memory" }, stdio: "ignore", detached: true });
  await waitFor(`http://127.0.0.1:${BOX_APP_PORT}/api/health`);

  // Clé du boîtier créée sur le cloud par le restaurateur
  const admin = await playwright.request.newContext();
  await loginDemo(admin, CLOUD);
  const created = await admin.post(`${CLOUD}/api/boxes`, { data: { name: "Boîtier e2e passerelle" } });
  const box = (await created.json()).data as { id: string; key: string };
  const key = box.key;
  boxId = box.id;
  await admin.dispose();

  await internet.up();
  // Passerelle lancée comme sur le mini-PC (vérification du cloud chaque seconde, copie toutes les 3 s)
  gateway = spawn("node", ["tools/box-gateway/gateway.mjs"], { env: { ...process.env, CLOUD_URL: `http://127.0.0.1:${WAN_PORT}`, LOCAL_URL: `http://127.0.0.1:${BOX_APP_PORT}`, BOX_TOKEN: key, BOX_SECRET: SECRET, DATA_DIR: dataDir, PORT: String(GATEWAY_PORT), HOST: "127.0.0.1", HEALTH_EVERY_MS: "1000", SYNC_EVERY_MS: "3000", LAN_IP: "192.168.1.40" }, stdio: ["ignore", fs.openSync(path.join(os.tmpdir(), "box-gateway-e2e.log"), "w"), "inherit"] });
  await waitFor(`${BOX}/__box/status`);
});

test.afterAll(async ({ playwright }) => {
  // Boîtier du test retiré (la liste de l'admin reste propre)
  const admin = await playwright.request.newContext();
  await loginDemo(admin, CLOUD);
  if (boxId) await admin.delete(`${CLOUD}/api/boxes/${boxId}`);
  await admin.dispose();
  gateway?.kill("SIGTERM");
  await internet.down();
  if (boxApp?.pid) try { process.kill(-boxApp.pid, "SIGTERM"); } catch { /* déjà arrêté */ }
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("coupure d'internet : le boîtier prend le relais, puis tout repart au cloud avec les mêmes ids", async ({ page, browser }) => {
  test.setTimeout(180_000);
  // En ligne : connexion par le boîtier, relayée au cloud
  await page.goto(`${BOX}/login`);
  await page.getByPlaceholder("vous@restaurant.pf").fill("demo@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);
  expect((await page.request.get(`${BOX}/api/auth/me`)).headers()["x-box-mode"]).toBe("relay");

  // Copie du restaurant dans le boîtier, faite après la connexion (la session de la tablette y est)
  const loggedAt = new Date().toISOString();
  await expect.poll(async () => { const s = await status(); return s.lastSyncError ?? (s.lastSync && s.lastSync > loggedAt ? "copie faite" : "en attente"); }, { timeout: 20_000 }).toBe("copie faite");

  // Internet coupé
  await internet.down();
  await expect.poll(async () => (await status()).mode, { timeout: 15_000 }).toBe("local");

  await page.goto(`${BOX}/pos`);
  await expect(page.getByTestId("box-bar")).toContainText("le boîtier de secours a pris le relais");
  // Le plan de salle s'affiche, servi par le boîtier
  await expect(page.locator("[data-testid=table-name]:visible").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: /Comptoir/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("caisse-boitier-relais.png") });
  const me = await page.request.get(`${BOX}/api/auth/me`);
  expect(me.status()).toBe(200);
  expect(me.headers()["x-box-mode"]).toBe("local");

  // Commande, envoi en cuisine et encaissement pendant la coupure
  const products = (await (await page.request.get(`${BOX}/api/products`)).json()).data as { id: string; isActive: boolean; modifierGroups?: unknown[] }[];
  const order = (await (await page.request.post(`${BOX}/api/orders`, { data: { type: "COUNTER" } })).json()).data;
  let withItem: { id: string; total: number } | null = null;
  for (const p of products.filter((x) => x.isActive)) {
    const r = await page.request.post(`${BOX}/api/orders/${order.id}/items`, { data: { productId: p.id } });
    if (r.ok()) { withItem = (await r.json()).data; break; }
  }
  expect(withItem).not.toBeNull();
  const sent = await page.request.post(`${BOX}/api/orders/${order.id}/send`, { data: { all: true } });
  expect(sent.status()).toBe(200);
  const local = (await sent.json()).data as { items: { id: string; kitchenTicketId: string | null }[]; total: number };
  const paid = await page.request.post(`${BOX}/api/orders/${order.id}/payments`, { data: { payments: [{ method: "CARD", amount: local.total }] } });
  expect(paid.status()).toBe(200);

  // Une deuxième tablette se connecte pendant la coupure (session du boîtier) et ouvre une commande
  const ctx2 = await browser.newContext();
  const tab2 = ctx2.request;
  await loginDemo(tab2, BOX);
  const order2 = (await (await tab2.post(`${BOX}/api/orders`, { data: { type: "TAKEAWAY", customerName: "Moana" } })).json()).data;
  expect((await status()).pending).toBeGreaterThanOrEqual(6);
  expect(fs.readFileSync(path.join(dataDir, "outbox.jsonl"), "utf8")).not.toContain("demo1234");

  // Internet revenu : rejeu, puis relais
  await internet.up();
  await expect.poll(async () => { const s = await status(); return `${s.mode}/${s.pending}`; }, { timeout: 30_000 }).toBe("relay/0");
  expect((await status()).conflicts).toEqual([]);

  // Le cloud a la même commande : mêmes ids, même bon cuisine, payée
  const cloudOrder = await page.request.get(`${BOX}/api/orders/${order.id}`);
  expect(cloudOrder.headers()["x-box-mode"]).toBe("relay");
  const co = (await cloudOrder.json()).data as { status: string; total: number; items: { id: string; kitchenTicketId: string | null }[] };
  expect(co.status).toBe("PAID");
  expect(co.total).toBe(local.total);
  expect(co.items.map((i) => [i.id, i.kitchenTicketId])).toEqual(local.items.map((i) => [i.id, i.kitchenTicketId]));

  // La deuxième tablette continue avec une session du cloud, sans se reconnecter
  const again = await tab2.get(`${BOX}/api/orders/${order2.id}`);
  expect(again.status()).toBe(200);
  expect(again.headers()["x-box-mode"]).toBe("relay");
  expect((await again.json()).data.customerName).toBe("Moana");
  expect(again.headers()["set-cookie"]).toContain("mr_session=");
  await ctx2.close();
  await expect(page.getByTestId("box-bar")).toHaveCount(0, { timeout: 15_000 });
});
