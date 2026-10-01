import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { NextRequest } from "next/server";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { createApiKey, listApiKeys, requireApiKey, revokeApiKey } from "@/server/api-keys";
import { createWebhook, deliver, setWebhookTransport, sign, verifySignature, listWebhooks } from "@/server/webhooks";
import { printDocument, sendTcp, upsertPrinter } from "@/server/hardware/printers";
import { bridgeAdapter, chargeOnTerminal, setTerminalFetcher } from "@/server/hardware/payment-terminal";
import { copyCatalog, organizationOverview } from "@/server/services/organization";
import { buildExport, toCsv } from "@/server/reports/export";
import { addItem, createOrder, sendCourse } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { createEstablishment } from "@/server/services/establishments";
import { localDay } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;
let tcp: Server; let tcpPort = 0; const received: Buffer[] = [];

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("advanced");
  tcp = createServer((socket) => { const chunks: Buffer[] = []; socket.on("data", (c) => chunks.push(c)); socket.on("end", () => received.push(Buffer.concat(chunks))); });
  await new Promise<void>((r) => tcp.listen(0, "127.0.0.1", () => { tcpPort = (tcp.address() as { port: number }).port; r(); }));
});
afterAll(async () => { await new Promise<void>((r) => tcp.close(() => r())); });

const req = (url: string, key?: string) => new NextRequest(`http://localhost${url}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });

describe("Phase 7 — API publique et webhooks", () => {
  it("clé API : création (affichée une fois), portées, révocation", async () => {
    const k = await createApiKey(T.managerActor, { name: "Comptable", scopes: ["orders:read", "reports:read"] });
    expect(k.key.startsWith("mr_live_")).toBe(true);
    expect((await listApiKeys(T.est.id))[0].prefix).toBe(k.key.slice(0, 12));
    const ctx = await requireApiKey(req("/api/v1/orders", k.key), "orders:read");
    expect(ctx.establishmentId).toBe(T.est.id);
    await expect(requireApiKey(req("/api/v1/products", k.key), "catalog:read")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireApiKey(req("/api/v1/orders", "mr_live_faux"), "orders:read")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(requireApiKey(req("/api/v1/orders"), "orders:read")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    // Clé dans l'adresse : refusée, même valide (elle finirait dans les journaux)
    await expect(requireApiKey(req(`/api/v1/orders?api_key=${k.key}`), "orders:read")).rejects.toMatchObject({ code: "API_KEY_IN_URL" });
    await revokeApiKey(T.managerActor, k.id);
    await expect(requireApiKey(req("/api/v1/orders", k.key), "orders:read")).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("webhook : signature HMAC, livraison avec tentatives, journal, désactivation après échecs", async () => {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    let mode: "ok" | "fail" = "ok";
    setWebhookTransport(async (url, body, headers) => { calls.push({ url, body, headers }); return mode === "ok" ? { status: 200, text: "ok" } : { status: 500, text: "boom" }; });
    const w = await createWebhook(T.managerActor, { url: "https://exemple.pf/hook", events: ["order.closed", "ping"] });
    expect(w.secret.startsWith("whsec_")).toBe(true);
    const r = await deliver(w.id, "order.closed", { orderId: "x" });
    expect(r?.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(verifySignature(w.secret, calls[0].body, calls[0].headers["X-ManaResto-Signature"])).toBe(true);
    expect(calls[0].headers["X-ManaResto-Signature"]).toBe(sign(w.secret, calls[0].body));
    expect(JSON.parse(calls[0].body).event).toBe("order.closed");
    mode = "fail";
    const f = await deliver(w.id, "order.closed", { orderId: "y" });
    expect(f?.ok).toBe(false);
    expect(f?.attempts).toBe(3);
    const list = await listWebhooks(T.est.id);
    expect(list[0].failures).toBe(1);
    expect(list[0].lastStatus).toBe(500);
    expect(list[0].deliveries.length).toBe(2);
    await prisma.webhook.update({ where: { id: w.id }, data: { failures: 19 } });
    await deliver(w.id, "order.closed", {});
    expect((await prisma.webhook.findUniqueOrThrow({ where: { id: w.id } })).isActive).toBe(false);
    setWebhookTransport(null);
  }, 40_000);

  it("les événements métier déclenchent les webhooks abonnés (paiement → order.closed)", async () => {
    const calls: string[] = [];
    setWebhookTransport(async (_u, body) => { calls.push(JSON.parse(body).event); return { status: 200, text: "" }; });
    const w = await createWebhook(T.managerActor, { url: "https://exemple.pf/hook2", events: ["order.closed"] });
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.eau.id });
    await sendCourse(T.actor, o.id, { all: true });
    await addPayments(T.actor, o.id, [{ method: "CARD", amount: 300 }]);
    await new Promise((r) => setTimeout(r, 300));
    expect(calls).toContain("order.closed");
    expect(calls.filter((c) => c !== "order.closed").length).toBe(0);
    await prisma.webhook.delete({ where: { id: w.id } });
    setWebhookTransport(null);
  });
});

describe("Phase 7 — imprimantes, TPE, multi-sites, comptabilité", () => {
  it("imprime un reçu et un test en ESC/POS sur une imprimante réseau (TCP) ; pilote agent → flux base64", async () => {
    const printer = await upsertPrinter(T.managerActor, { name: "Caisse", kind: "RECEIPT", driver: "escpos-network", connection: { host: "127.0.0.1", port: tcpPort } });
    const t = await printDocument(T.est.id, printer.id, { kind: "test" });
    expect(t.delivered).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(received.length).toBe(1);
    expect(received[0][0]).toBe(0x1b);
    expect(received[0].toString("latin1")).toContain("Test d'impression");
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.eau.id, quantity: 2 });
    const r = await printDocument(T.est.id, printer.id, { kind: "receipt", orderId: o.id });
    expect(r.delivered).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(received[1].toString("latin1")).toContain("Eau");
    const agent = await upsertPrinter(T.managerActor, { name: "Agent", kind: "KITCHEN", driver: "agent", connection: { agentUrl: "http://192.168.1.20:9123/print" } });
    const a = await printDocument(T.est.id, agent.id, { kind: "test" });
    expect(a.delivered).toBe(false);
    expect(a.agentUrl).toBe("http://192.168.1.20:9123/print");
    expect(Buffer.from(a.payloadBase64!, "base64")[0]).toBe(0x1b);
    await expect(sendTcp("127.0.0.1", 1, new Uint8Array([0x1b]), 500)).rejects.toBeTruthy();
    await expect(upsertPrinter(T.managerActor, { name: "X", kind: "RECEIPT", driver: "escpos-network" })).rejects.toMatchObject({ code: "HOST_REQUIRED" });
  });

  it("bons cuisine imprimés automatiquement à l'envoi sur l'imprimante réseau du poste", async () => {
    const before = received.length;
    await upsertPrinter(T.managerActor, { name: "Cuisine", kind: "KITCHEN", driver: "escpos-network", connection: { host: "127.0.0.1", port: tcpPort } });
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.eau.id });
    await sendCourse(T.actor, o.id, { all: true });
    await new Promise((r) => setTimeout(r, 300));
    expect(received.length).toBe(before + 1);
    expect(received[received.length - 1].toString("latin1")).toContain("COMPTOIR");
  });

  it("TPE via passerelle : transaction acceptée avec référence, refus, absence de TPE", async () => {
    setTerminalFetcher(async (url, init) => { const body = JSON.parse(String(init?.body)); if (String(url).endsWith("/charge")) return new Response(JSON.stringify(body.amount === 999 ? { ok: false, message: "Carte refusée" } : { ok: true, providerRef: `TX-${body.amount}` }), { status: 200 }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); });
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.eau.id, quantity: 3 }); // 900 F
    await expect(chargeOnTerminal(T.actor, o.id, 900)).rejects.toMatchObject({ code: "NO_TERMINAL" });
    await prisma.establishment.update({ where: { id: T.est.id }, data: { settings: { payments: { terminal: { adapter: "bridge", url: "http://bridge.local", terminalId: "TPE1" } } } } });
    const r = await chargeOnTerminal(T.actor, o.id, 900);
    expect(r.providerRef).toBe("TX-900");
    // Le paiement est enregistré dans la même requête que le débit
    expect(r.order.status).toBe("PAID");
    expect(r.payments[0]).toMatchObject({ method: "CARD", amount: 900, reference: "TX-900" });
    await expect(chargeOnTerminal(T.actor, o.id, 900)).rejects.toMatchObject({ code: "ORDER_CLOSED" });
    const o2 = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o2.id, { productId: T.eau.id, quantity: 4 });
    await expect(chargeOnTerminal(T.actor, o2.id, 5000)).rejects.toMatchObject({ code: "BAD_AMOUNT" });
    await expect(chargeOnTerminal(T.actor, o2.id, 999)).rejects.toMatchObject({ code: "TERMINAL_DECLINED" });
    const adapter = bridgeAdapter({ adapter: "bridge", url: "http://bridge.local" });
    expect((await adapter.refund("TX-900", 900)).ok).toBe(true);
    expect((await prisma.auditLog.count({ where: { action: "terminal.charge" } }))).toBe(2);
    setTerminalFetcher(null);
  });

  it("copie de catalogue vers un second établissement et vue consolidée", async () => {
    const est2 = await createEstablishment(T.org.id, T.owner.id, { name: "Annexe Moorea", city: "Moorea" });
    const stats = await copyCatalog({ ...T.managerActor, userId: T.owner.id }, T.est.id, est2.id);
    expect(stats.products).toBe(4);
    expect(stats.modifierGroups).toBe(2);
    expect(stats.menus).toBe(1);
    const again = await copyCatalog({ ...T.managerActor, userId: T.owner.id }, T.est.id, est2.id);
    expect(again.products).toBe(0); // pas de doublons
    const burger = await prisma.product.findFirst({ where: { establishmentId: est2.id, name: "Burger" }, include: { modifierGroups: true, variants: true } });
    expect(burger?.modifierGroups.length).toBe(2);
    const menu = await prisma.menu.findFirst({ where: { establishmentId: est2.id }, include: { sections: { include: { items: true } } } });
    expect(menu?.sections.flatMap((s) => s.items).length).toBe(2);
    const today = localDay(new Date(), "Pacific/Tahiti");
    const ov = await organizationOverview(T.org.id, today, today);
    expect(ov.rows.length).toBe(2);
    expect(ov.total.revenue).toBeGreaterThanOrEqual(300);
    expect(ov.rows.find((r) => r.establishment.id === est2.id)!.revenue).toBe(0);
  });

  it("export comptable : ventes par taux de TVA, encaissements, écritures équilibrées", async () => {
    const today = localDay(new Date(), "Pacific/Tahiti");
    const o = await createOrder(T.actor, { type: "COUNTER" });
    const saignant = T.cuisson.modifiers.find((m) => m.name === "Saignant")!;
    await addItem(T.actor, o.id, { productId: T.burger.id, modifiers: [{ modifierId: saignant.id }] }); // 2100 à 13 %
    await addItem(T.actor, o.id, { productId: T.biere.id }); // 600 à 16 %
    await sendCourse(T.actor, o.id, { all: true });
    await addPayments(T.actor, o.id, [{ method: "CARD", amount: 2700 }]);
    const { sheets } = await buildExport(T.est.id, "accounting", today, today, "Pacific/Tahiti");
    const sales = sheets.find((s) => s.name === "Ventes par taux TVA")!;
    expect(sales.rows.some((r) => r[1] === "13 %")).toBe(true);
    expect(sales.rows.some((r) => r[1] === "16 %")).toBe(true);
    const entries = sheets.find((s) => s.name === "Écritures")!;
    const debit = entries.rows.reduce((a, r) => a + Number(r[4]), 0), credit = entries.rows.reduce((a, r) => a + Number(r[5]), 0);
    expect(debit).toBe(credit);
    expect(entries.rows.some((r) => String(r[2]).startsWith("445710"))).toBe(true);
    expect(entries.rows.some((r) => r[2] === "512000")).toBe(true);
    const csv = toCsv(sheets);
    expect(csv).toContain("# Écritures");
    expect(csv).toContain("N° Tahiti");
  });
});
