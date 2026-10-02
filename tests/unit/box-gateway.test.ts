import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { completeBody, createGateway, injectIds } from "../../tools/box-gateway/gateway.mjs";

type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };

/** Faux serveur (cloud ou application du boîtier) : note chaque requête, répond selon `reply`. */
function fake(reply: (r: Seen, res: http.ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const r = { method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") };
      seen.push(r);
      reply(r, res);
    });
  });
  let port = 0;
  return {
    seen, server,
    get url() { return `http://127.0.0.1:${port}`; },
    start: () => new Promise<void>((resolve) => server.listen(port, "127.0.0.1", () => { port = (server.address() as AddressInfo).port; resolve(); })),
    stop: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
const json = (res: http.ServerResponse, status: number, data: unknown, headers: Record<string, string | string[]> = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(data));
};

const cloud = fake((r, res) => {
  if (r.url === "/api/health") return json(res, 200, { status: "ok" });
  if (r.url === "/api/box/snapshot") return r.headers.authorization === "Bearer mrbox_test" ? json(res, 200, { data: { format: 1, schema: "x", tables: { orders: [] } } }) : json(res, 401, {});
  if (r.url === "/api/box/sessions") return r.headers.authorization === "Bearer mrbox_test" && JSON.parse(r.body).userId === "u-serveuse" ? json(res, 200, { data: { token: "CLOUD1", maxAge: 3600 } }) : json(res, 401, {});
  if (r.url === "/api/conflit") return json(res, 409, { error: { code: "TABLE_TAKEN", message: "Table déjà occupée" } });
  if (r.url === "/_next/static/chunks/app.js") { res.writeHead(200, { "content-type": "application/javascript" }); return res.end("/* version du cloud */"); }
  if (r.url === "/redirige") { res.writeHead(307, { location: `${cloud.url}/pos/login` }); return res.end(); }
  json(res, 200, { data: { from: "cloud" } });
});
const local = fake((r, res) => {
  const body = r.body ? JSON.parse(r.body) : {};
  if (r.url === "/api/box/import") return json(res, 200, { data: { imported: {} } });
  if (r.url === "/api/auth/pin") return json(res, 200, { data: { id: "u-serveuse", firstName: "Moana" } }, { "set-cookie": "mr_session=LOCAL1; Path=/; HttpOnly; Max-Age=3600" });
  if (r.url === "/api/orders" && r.method === "POST") return json(res, 201, { data: { id: body.id, courses: [{ id: "11111111-1111-4111-8111-111111111111", name: "Entrées", status: "PENDING" }], openedAt: "2026-10-02T06:00:00.000Z" } });
  if (r.url.startsWith("/_next/static/")) { res.writeHead(404); return res.end(); }
  if (r.url === "/api/refuse") return json(res, 400, { error: { message: "non" } });
  json(res, 200, { data: { from: "local", body } });
});

let dir: string;
let gw: ReturnType<typeof createGateway>;
let base: string;
const make = () => createGateway({ cloudUrl: cloud.url, localUrl: local.url, dataDir: dir, boxToken: "mrbox_test", boxSecret: "s".repeat(32), healthEvery: 1e9, syncEvery: 1e9, connectTimeout: 1000, log: () => {} });
const call = (p: string, init: RequestInit = {}) => fetch(base + p, { redirect: "manual", ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });

beforeAll(async () => {
  await cloud.start();
  await local.start();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "box-gw-"));
  gw = make();
  const addr = await gw.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(addr as AddressInfo).port}`;
});
afterAll(async () => {
  await gw?.close();
  await cloud.stop().catch(() => {});
  await local.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("passerelle du boîtier : ids fixés pour le rejeu", () => {
  it("commande, article, ouverture de caisse et paiements reçoivent un id ; le reste est intact", () => {
    const order = JSON.parse(injectIds("POST", "/api/orders", Buffer.from(JSON.stringify({ type: "DINE_IN" }))).toString());
    expect(order.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(injectIds("POST", "/api/orders/abc/items", Buffer.from('{"productId":"p","id":"garde"}')).toString()).id).toBe("garde");
    const pay = JSON.parse(injectIds("POST", "/api/orders/abc/payments", Buffer.from('{"payments":[{"method":"CASH","amount":500},{"id":"x","method":"CARD","amount":100}]}')).toString());
    expect(pay.payments[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(pay.payments[1].id).toBe("x");
    const other = Buffer.from('{"reason":"r"}');
    expect(injectIds("POST", "/api/orders/abc/cancel", other)).toBe(other);
  });

  it("une commande créée pendant la coupure emporte ses services et son heure d'ouverture", () => {
    const body = completeBody("POST", "/api/orders", Buffer.from('{"id":"o1"}'), Buffer.from(JSON.stringify({ data: { id: "o1", courses: [{ id: "c1", name: "Plats", status: "PENDING" }], openedAt: "2026-10-02T06:00:00.000Z" } })));
    expect(JSON.parse(body.toString())).toEqual({ id: "o1", courses: [{ id: "c1", name: "Plats" }], openedAt: "2026-10-02T06:00:00.000Z" });
  });
});

describe("passerelle du boîtier : relais, coupure, rejeu", () => {
  it("en ligne : tout part au cloud, la copie du restaurant arrive dans le boîtier", async () => {
    const r = await call("/api/test");
    expect(r.headers.get("x-box-mode")).toBe("relay");
    expect((await r.json()).data.from).toBe("cloud");
    expect(cloud.seen.at(-1)?.headers.host).toBe(new URL(cloud.url).host);
    // Fichier de l'application du cloud gardé pour la coupure
    expect(await (await call("/_next/static/chunks/app.js")).text()).toContain("cloud");
    // Redirection du cloud ramenée sur l'adresse du boîtier
    expect((await call("/redirige")).headers.get("location")).toBe("/pos/login");

    await gw.sync();
    const imp = local.seen.find((x) => x.url === "/api/box/import");
    expect(imp?.headers["x-box-secret"]).toBe("s".repeat(32));
    expect(JSON.parse(imp!.body).format).toBe(1);
    expect(gw.status().lastSync).toBeTruthy();
  });

  it("internet coupé : le boîtier répond et garde chaque saisie, dans l'ordre", async () => {
    await cloud.stop();
    const created = await call("/api/orders", { method: "POST", body: JSON.stringify({ type: "DINE_IN", tableId: "t1" }) });
    expect(created.status).toBe(201);
    expect(created.headers.get("x-box-mode")).toBe("local");
    const orderId = (await created.json()).data.id;
    expect(orderId).toMatch(/^[0-9a-f-]{36}$/);
    expect(gw.status().mode).toBe("local");

    const login = await call("/api/auth/pin", { method: "POST", body: JSON.stringify({ pin: "1001" }), headers: { cookie: "mr_terminal=T1" } });
    expect(login.headers.getSetCookie()[0]).toContain("mr_session=LOCAL1");
    await call(`/api/orders/${orderId}/items`, { method: "POST", body: JSON.stringify({ productId: "p1" }), headers: { cookie: "mr_terminal=T1; mr_session=LOCAL1" } });
    await call(`/api/orders/${orderId}/payments`, { method: "POST", body: JSON.stringify({ payments: [{ method: "CASH", amount: 1200 }] }), headers: { cookie: "mr_session=LOCAL1", "idempotency-key": "cle-tablette" } });
    await call("/api/conflit", { method: "POST", body: "{}" });
    // Non gardés : interrogation d'une imprimante, saisie refusée par le boîtier, lecture
    await call("/api/hardware/cloud/jeton", { method: "POST", body: "{}" });
    await call("/api/refuse", { method: "POST", body: "{}" });
    expect((await (await call("/api/test")).json()).data.from).toBe("local");
    // Fichier du cloud absent du boîtier : servi depuis la copie gardée
    expect(await (await call("/_next/static/chunks/app.js")).text()).toContain("cloud");

    expect(gw.status().pending).toBe(5);
    expect(gw.store.outbox.map((e: { url: string }) => e.url)).toEqual(["/api/orders", "/api/auth/pin", `/api/orders/${orderId}/items`, `/api/orders/${orderId}/payments`, "/api/conflit"]);
    const first = JSON.parse(Buffer.from(gw.store.outbox[0].body, "base64").toString());
    expect(first).toMatchObject({ id: orderId, tableId: "t1", courses: [{ id: "11111111-1111-4111-8111-111111111111", name: "Entrées" }], openedAt: "2026-10-02T06:00:00.000Z" });
    // Le PIN n'est jamais écrit sur le disque : seule la personne connectée est notée
    expect(gw.store.outbox[1]).toMatchObject({ body: null, login: { userId: "u-serveuse" }, localSession: "LOCAL1" });
    expect(fs.readFileSync(path.join(dir, "outbox.jsonl"), "utf8")).not.toContain("1001");
  });

  it("la file survit à un redémarrage du boîtier : il reste en local jusqu'au rejeu", async () => {
    const again = make();
    expect(again.state.mode).toBe("local");
    expect(again.store.outbox).toHaveLength(5);
    await again.close();
  });

  it("internet revenu : rejeu au cloud dans l'ordre, mêmes ids, session du cloud, puis relais", async () => {
    const before = cloud.seen.length;
    await cloud.start();
    await gw.checkCloud();
    const replayed = cloud.seen.slice(before).filter((x) => x.url !== "/api/health" && x.url !== "/api/box/snapshot");
    expect(replayed.map((x) => x.url)).toEqual(["/api/orders", "/api/box/sessions", expect.stringMatching(/\/items$/), expect.stringMatching(/\/payments$/), "/api/conflit"]);
    for (const x of replayed) expect(x.headers["x-offline-replay"]).toBe("1");
    expect(replayed[0].headers["idempotency-key"]).toMatch(/^box-/);
    expect(replayed[1].headers.authorization).toBe("Bearer mrbox_test");
    expect(replayed[1].headers.cookie).toBe("mr_terminal=T1"); // le terminal suit
    expect(replayed[3].headers["idempotency-key"]).toBe("cle-tablette");
    // Les saisies faites avec la session du boîtier partent avec celle du cloud
    expect(replayed[2].headers.cookie).toContain("mr_session=CLOUD1");
    expect(replayed[2].headers.cookie).toContain("mr_terminal=T1");
    expect(JSON.parse(replayed[3].body).payments[0].id).toMatch(/^[0-9a-f-]{36}$/);

    const st = gw.status();
    expect(st.mode).toBe("relay");
    expect(st.pending).toBe(0);
    expect(st.conflicts[0]).toMatchObject({ url: "/api/conflit", status: 409, message: "Table déjà occupée" });
    expect(fs.readFileSync(path.join(dir, "outbox.jsonl"), "utf8")).toBe(""); // file vidée

    // La tablette encore sur la session du boîtier : relayée avec celle du cloud, qui lui est donnée
    const r = await call("/api/test", { headers: { cookie: "mr_session=LOCAL1" } });
    expect(r.headers.get("x-box-mode")).toBe("relay");
    expect(cloud.seen.at(-1)?.headers.cookie).toBe("mr_session=CLOUD1");
    expect(r.headers.getSetCookie().join(";")).toContain("mr_session=CLOUD1");
  });

  it("état du boîtier lisible par les tablettes", async () => {
    const r = await call("/__box/status");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toMatchObject({ mode: "relay", pending: 0 });
  });
});
