import { afterAll, beforeAll, describe, expect, it } from "vitest";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { createAgent, isLocalHost, parseTarget, resolveTarget } from "../../tools/print-agent/print-agent.mjs";

/** Fausse imprimante thermique : garde ce qu'elle reçoit. */
function fakePrinter() {
  const received: Buffer[] = [];
  const server = net.createServer((sock) => { const parts: Buffer[] = []; sock.on("data", (d) => parts.push(d)); sock.on("end", () => received.push(Buffer.concat(parts))); });
  return { server, received, listen: () => new Promise<number>((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port))) };
}

let a: ReturnType<typeof fakePrinter>, b: ReturnType<typeof fakePrinter>;
let portA = 0, portB = 0, agentPort = 0;
let agent: ReturnType<typeof createAgent>;
const quiet = { log: () => {}, error: () => {} } as unknown as Console;
const post = (body: unknown, token?: string) => fetch(`http://127.0.0.1:${agentPort}/print`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const b64 = (s: string) => Buffer.from(s, "latin1").toString("base64");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  a = fakePrinter(); b = fakePrinter();
  portA = await a.listen(); portB = await b.listen();
  // Deux imprimantes déclarées (ports de test, hors des ports d'impression habituels) ; A est celle par défaut
  agent = createAgent({ printers: [{ host: "127.0.0.1", port: portA }, { host: "127.0.0.1", port: portB }], token: undefined, log: quiet });
  await new Promise<void>((r) => agent.listen(0, "127.0.0.1", () => { agentPort = (agent.address() as AddressInfo).port; r(); }));
});
afterAll(async () => { agent.close(); a.server.close(); b.server.close(); });

describe("Agent d'impression : imprimantes Wi-Fi du restaurant", () => {
  it("adresses du réseau local reconnues, jamais internet", () => {
    for (const h of ["192.168.1.50", "10.0.0.7", "172.16.4.9", "172.31.255.1", "169.254.3.3", "127.0.0.1", "imprimante.local", "localhost"]) expect(isLocalHost(h)).toBe(true);
    for (const h of ["8.8.8.8", "172.32.0.1", "172.15.0.1", "1.1.1.1", "manaresto.com", "", "192.168.1"]) expect(isLocalHost(h)).toBe(false);
    expect(parseTarget("192.168.1.50")).toEqual({ host: "192.168.1.50", port: 9100 });
    expect(parseTarget("192.168.1.50:515")).toEqual({ host: "192.168.1.50", port: 515 });
  });

  it("cible : déclarée, locale sur un port d'impression, sinon refusée ; par défaut la première déclarée", () => {
    const printers = [{ host: "192.168.1.50", port: 9100 }, { host: "192.168.1.51", port: 7000 }];
    expect(resolveTarget({}, printers)).toEqual(printers[0]);
    expect(resolveTarget({ host: "192.168.1.51", port: 7000 }, printers)).toEqual(printers[1]); // port inhabituel mais déclaré
    expect(resolveTarget({ host: "192.168.1.60" }, printers)).toEqual({ host: "192.168.1.60", port: 9100 });
    expect(resolveTarget({ host: "192.168.1.60", port: 515 }, printers)).toEqual({ host: "192.168.1.60", port: 515 });
    expect(resolveTarget({ host: "192.168.1.60", port: 22 }, printers)).toBeNull(); // pas un port d'imprimante
    expect(resolveTarget({ host: "8.8.8.8", port: 9100 }, printers)).toBeNull(); // internet : jamais
  });

  it("imprime sur l'imprimante par défaut, sur l'imprimante visée, refuse une adresse hors réseau, répond à /status", async () => {
    const r1 = await post({ payloadBase64: b64("TICKET A") });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ ok: true, printer: `127.0.0.1:${portA}` });
    const r2 = await post({ payloadBase64: b64("TICKET B"), host: "127.0.0.1", port: portB });
    expect(r2.status).toBe(200);
    await wait(50);
    expect(a.received.map((x) => x.toString("latin1"))).toEqual(["TICKET A"]);
    expect(b.received.map((x) => x.toString("latin1"))).toEqual(["TICKET B"]);
    const r3 = await post({ payloadBase64: b64("X"), host: "8.8.8.8", port: 9100 });
    expect(r3.status).toBe(403);
    const r4 = await post({});
    expect(r4.status).toBe(500);
    expect((await r4.json()).error).toContain("payloadBase64");
    const status = await (await fetch(`http://127.0.0.1:${agentPort}/status`)).json();
    expect(status).toMatchObject({ ok: true, printers: [`127.0.0.1:${portA}`, `127.0.0.1:${portB}`] });
    // Imprimante éteinte : erreur claire, l'agent reste debout
    const r5 = await post({ payloadBase64: b64("X"), host: "127.0.0.1", port: 9101 });
    expect(r5.status).toBe(500);
    expect((await r5.json()).error).toMatch(/127\.0\.0\.1:9101/);
  });

  it("jeton : refusé sans l'en-tête, accepté avec", async () => {
    const secured = createAgent({ printers: [{ host: "127.0.0.1", port: portA }], token: "secret", log: quiet });
    const port = await new Promise<number>((r) => secured.listen(0, "127.0.0.1", () => r((secured.address() as AddressInfo).port)));
    try {
      expect((await fetch(`http://127.0.0.1:${port}/print`, { method: "POST", body: JSON.stringify({ payloadBase64: b64("x") }) })).status).toBe(401);
      expect((await fetch(`http://127.0.0.1:${port}/print`, { method: "POST", headers: { Authorization: "Bearer secret" }, body: JSON.stringify({ payloadBase64: b64("x") }) })).status).toBe(200);
    } finally { secured.close(); }
  });
});
