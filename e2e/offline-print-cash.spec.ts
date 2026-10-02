import { test, expect, type Page } from "@playwright/test";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/**
 * Lot 3 hors ligne : impression et caisse sans internet. Une fausse imprimante thermique (TCP) et le vrai agent
 * d'impression (tools/print-agent) tournent sur le « réseau local » ; seul le serveur ManaResto est coupé.
 */
let printer: net.Server;
let agent: ChildProcess;
const received: Buffer[] = [];
let agentUrl = "";
const printedText = () => received.map((b) => b.toString("latin1")).join("\n");

test.beforeAll(async () => {
  printer = net.createServer((sock) => { const parts: Buffer[] = []; sock.on("data", (d) => parts.push(d)); sock.on("end", () => received.push(Buffer.concat(parts))); });
  await new Promise<void>((r) => printer.listen(0, "127.0.0.1", r));
  const printerPort = (printer.address() as net.AddressInfo).port;
  const agentPort = 19000 + Math.floor(Math.random() * 900);
  agent = spawn(process.execPath, [path.join(__dirname, "../tools/print-agent/print-agent.mjs"), "--port", String(agentPort), "--printer", `127.0.0.1:${printerPort}`], { stdio: "pipe" });
  await new Promise<void>((r) => agent.stdout!.once("data", () => r()));
  agentUrl = `http://127.0.0.1:${agentPort}/print`;
});

test.afterAll(async () => { agent?.kill(); await new Promise((r) => printer?.close(r)); });

async function offlineReady(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 15000 });
  await expect.poll(() => page.evaluate(async () => {
    for (const name of await caches.keys()) if (await (await caches.open(name)).match("/pos/order/__shell__")) return true;
    return false;
  }), { timeout: 30000 }).toBe(true);
}

test("hors ligne : caisse ouverte, bon cuisine, tiroir et ticket imprimés sur place, clôture juste au retour du réseau", async ({ page, context }) => {
  test.setTimeout(120_000);
  await page.goto("/login");
  await page.getByPlaceholder("vous@restaurant.pf").fill("manager@manaresto.pf");
  await page.getByLabel("Mot de passe").fill("demo1234");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL(/\/(pos|admin)/);

  // Imprimantes du restaurant reliées par l'agent local : ticket (avec tiroir) et cuisine (restes d'un essai interrompu supprimés)
  for (const p of (await (await page.request.get("/api/printers")).json()).data as { id: string; name: string }[]) {
    if (/^(Ticket|Cuisine) agent \d+$/.test(p.name)) await page.request.delete(`/api/printers/${p.id}`);
  }
  const stamp = Date.now();
  const mk = async (data: object) => (await (await page.request.post("/api/printers", { data })).json()).data as { id: string };
  const receipt = await mk({ name: `Ticket agent ${stamp}`, kind: "RECEIPT", driver: "agent", connection: { agentUrl }, hasDrawer: true, drawerPin: 2 });
  const kitchen = await mk({ name: `Cuisine agent ${stamp}`, kind: "KITCHEN", driver: "agent", connection: { agentUrl } });
  try {
    // Pas de caisse ouverte avant la coupure
    const cur = (await (await page.request.get("/api/cash/current")).json()).data as { session: { id: string } } | null;
    if (cur) await page.request.post(`/api/cash/${cur.session.id}/close`, { data: { countedCash: 0 } });
    const catalog = (await (await page.request.get("/api/pos/catalog")).json()).data as { products: { name: string; priceTtc: number }[] };
    const coca = catalog.products.find((p) => p.name === "Coca-Cola 33 cl")!;

    await page.goto("/pos");
    await offlineReady(page);
    await page.goto("/pos/cash");
    await expect(page.getByText("Aucune session de caisse ouverte")).toBeVisible();

    // ---- Coupure : seul le serveur ManaResto est injoignable, le réseau local (agent, imprimante) reste là
    await context.route((url) => !url.href.startsWith(agentUrl.replace("/print", "")), (r) => r.abort("internetdisconnected"));
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    // Ouverture de la caisse et entrée d'espèces, sans internet
    await page.getByRole("button", { name: "Ouvrir la caisse" }).first().click();
    for (const d of "10000") await page.getByRole("dialog", { name: "Ouvrir la caisse" }).getByRole("button", { name: d, exact: true }).click();
    await page.getByRole("dialog", { name: "Ouvrir la caisse" }).getByRole("button", { name: "Ouvrir" }).click();
    await expect(page.getByText(/caisse ouverte sur cette tablette/)).toBeVisible();
    await page.getByRole("button", { name: /Entrée \/ sortie d'espèces/ }).click();
    const mv = page.getByRole("dialog", { name: "Mouvement d'espèces" });
    await mv.getByRole("button", { name: "Entrée", exact: true }).click();
    for (const d of "500") await mv.getByRole("button", { name: d, exact: true }).click();
    await mv.getByPlaceholder("Motif (obligatoire)").fill("Monnaie");
    await mv.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByText(/mouvement enregistré/)).toBeVisible();

    // Une table : commande, envoi en cuisine → bon imprimé tout de suite sur l'imprimante cuisine
    await page.goto("/pos");
    await page.locator("button[title='Libre']:visible").last().click(); // la dernière : les autres tests (en parallèle) prennent la première
    await page.getByRole("button", { name: "2", exact: true }).click();
    await page.waitForURL(/\/pos\/order\//);
    const orderId = page.url().split("/pos/order/")[1];
    await page.getByRole("button", { name: "Boissons" }).click();
    await page.locator("section").first().getByRole("button", { name: "Ajouter Coca-Cola 33 cl" }).click();
    await page.getByRole("button", { name: /Envoyer/ }).click();
    await page.getByRole("button", { name: "Tout envoyer" }).click();
    await expect(page.getByText(/bon cuisine imprimé/)).toBeVisible();
    await expect.poll(printedText).toContain("Coca-Cola 33 cl");
    expect(printedText()).toContain("envoye sans internet");

    // Encaissement espèces : tiroir ouvert par l'agent, ticket imprimé sur place
    const before = received.length;
    await page.getByRole("button", { name: /Payer/ }).click();
    await page.getByRole("button", { name: "Espèces", exact: true }).click();
    await page.getByRole("button", { name: /Encaisser/ }).click();
    await expect(page.getByRole("heading", { name: "Commande soldée" })).toBeVisible();
    await expect.poll(() => received.slice(before).some((b) => b.includes(Buffer.from([0x1b, 0x70])))).toBe(true); // impulsion tiroir
    await page.getByTestId("print-receipt").click(); // le serveur est injoignable : ticket construit et imprimé par la tablette
    await expect.poll(() => received.slice(before).map((b) => b.toString("latin1")).join("")).toContain("TOTAL TTC");
    await page.getByRole("button", { name: "Terminer" }).click();

    // Caisse : espèces théoriques tenues sur la tablette, clôture sans internet
    await page.goto("/pos/cash");
    const expected = 10000 + 500 + coca.priceTtc;
    await expect(page.locator("section", { hasText: "Espèces théoriques" })).toContainText(new Intl.NumberFormat("fr-FR").format(expected).replace(/\s/g, " "));
    await page.getByRole("button", { name: "Clôturer la caisse" }).click();
    const close = page.getByRole("dialog", { name: "Clôturer la caisse" });
    for (const d of String(expected)) await close.getByRole("button", { name: d, exact: true }).click();
    await close.getByRole("button", { name: "Confirmer la clôture" }).click();
    await expect(page.getByText(/caisse clôturée sur cette tablette \(écart 0 F\)/)).toBeVisible();

    // ---- Retour du réseau : le serveur refait le calcul, même résultat
    await context.unrouteAll();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await (await page.request.get(`/api/orders/${orderId}`)).json()).data?.status, { timeout: 30000 }).toBe("PAID");
    await expect.poll(async () => (await (await page.request.get("/api/cash/current")).json()).data, { timeout: 30000 }).toBeNull();
    const sessions = (await (await page.request.get("/api/cash")).json()).data as { status: string; openingFloat: number; expectedCash: number | null; countedCash: number | null }[];
    const closed = sessions.find((x) => x.status === "CLOSED" && x.openingFloat === 10000 && x.countedCash === expected)!;
    expect(closed.expectedCash).toBe(expected);
  } finally {
    await context.unrouteAll();
    for (const p of [receipt, kitchen]) await page.request.delete(`/api/printers/${p.id}`);
  }
});
