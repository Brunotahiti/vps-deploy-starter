import { beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, createOrder, sendCourse } from "@/server/services/orders";
import { setTicketStatus } from "@/server/services/kitchen";
import { notifyDishReady, sentPushes, subscribePush } from "@/server/push";
import { apnsConfig, apnsJwt, closeApnsSessions, apnsPayload, isApnsConfigured, registerApnsDevice, sentApns, setApnsTransport, unregisterApnsDevice } from "@/server/apns";

let T: Awaited<ReturnType<typeof makeTenant>>;
const token = (c: string) => c.repeat(64);
const waitFor = (fn: () => boolean) => vi.waitFor(() => { if (!fn()) throw new Error("pas encore"); }, { timeout: 3000, interval: 25 });
const cuisson = () => [{ modifierId: T.cuisson.modifiers.find((m) => m.name === "Saignant")!.id }];

beforeAll(async () => {
  process.env.PUSH_TRANSPORT = "memory";
  await resetDb();
  T = await makeTenant("apns");
});

describe("Notifications « plat prêt » dans l'app iOS (APNs)", () => {
  it("jeton d'accès Apple : JWT ES256 avec l'identifiant de clé et l'équipe, signature vérifiable", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = apnsJwt({ keyId: "ABC123DEFG", teamId: "TEAM123456", privateKey: pem }, Date.UTC(2026, 10, 15, 2, 0, 0));
    const [h, c, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({ iss: "TEAM123456", iat: Date.UTC(2026, 10, 15, 2, 0, 0) / 1000 });
    expect(Buffer.from(s, "base64url")).toHaveLength(64); // signature brute r ‖ s, comme l'exige Apple
    expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("configuration : clé .p8 en variable d'environnement, retours à la ligne « \\n » acceptés", () => {
    const saved = { ...process.env };
    try {
      delete process.env.PUSH_TRANSPORT;
      process.env.APNS_KEY_ID = "";
      expect(isApnsConfigured()).toBe(false);
      Object.assign(process.env, { APNS_KEY_ID: "K", APNS_TEAM_ID: "T", APNS_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----" });
      const cfg = apnsConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.privateKey).toBe("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
      expect(cfg.bundleId).toBe("com.manaresto.caisse");
    } finally {
      process.env = saved;
    }
  });

  it("enregistrement : un jeton par appareil, au nom de la personne connectée ; jeton invalide refusé", async () => {
    await registerApnsDevice(T.actor, { token: token("a"), environment: "production", deviceName: "iPhone de Teva" });
    await registerApnsDevice(T.managerActor, { token: token("b"), environment: "sandbox" });
    // Le même iPhone repris par le manager (changement d'utilisateur) change de propriétaire
    await registerApnsDevice(T.managerActor, { token: token("A"), environment: "production" });
    expect(await prisma.apnsDevice.count()).toBe(2);
    expect((await prisma.apnsDevice.findUniqueOrThrow({ where: { token: token("a") } })).userId).toBe(T.manager.id);
    await registerApnsDevice(T.actor, { token: token("a"), environment: "production" });
    await expect(registerApnsDevice(T.actor, { token: "pas-un-jeton", environment: "production" })).rejects.toMatchObject({ code: "BAD_TOKEN" });
  });

  it("ticket PRÊT : l'iPhone du serveur de la table reçoit la notification, avec la commande à ouvrir", async () => {
    sentApns.length = 0;
    sentPushes.length = 0;
    await subscribePush(T.actor, { endpoint: "https://fcm.googleapis.com/fcm/send/navigateur-serveur", keys: { p256dh: "p", auth: "a" } });
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 2 });
    await addItem(T.actor, o.id, { productId: T.burger.id, courseId: o.courses[2].id, modifiers: cuisson() });
    await sendCourse(T.actor, o.id, { all: true });
    const ticket = await prisma.kitchenTicket.findFirstOrThrow({ where: { orderId: o.id } });
    await setTicketStatus(T.managerActor, ticket.id, "READY"); // le manager joue la cuisine : son propre iPhone n'est pas prévenu
    await waitFor(() => sentApns.length === 1 && sentPushes.length === 1);
    const [m] = sentApns;
    expect(m.token).toBe(token("a"));
    expect(m.environment).toBe("production");
    expect(m.payload.aps.alert.title).toBe("Plat prêt · Table T01");
    expect(m.payload.aps.alert.body).toContain("Burger");
    expect(m.payload.aps.sound).toBe("default");
    expect(m.payload.orderId).toBe(o.id);
    expect(m.collapseId).toBe(`ready-${o.id}`);
    expect(sentPushes[0].endpoint).toBe("https://fcm.googleapis.com/fcm/send/navigateur-serveur"); // le navigateur du serveur aussi
    expect(sentPushes[0].payload.orderId).toBe(o.id);
  });

  it("sans appareil du serveur de la commande : toute l'équipe équipée de l'app est prévenue", async () => {
    sentApns.length = 0;
    const r = await notifyDishReady({ organizationId: T.org.id, establishmentId: T.est.id, userId: T.owner.id }, { orderId: "00000000-0000-0000-0000-000000000001", items: [{ name: "Burger", quantity: 2, status: "READY" }], order: { number: "20261115-0007", type: "COUNTER", serverId: null, customerName: "Hina", table: null } });
    expect(r.sent).toBeGreaterThanOrEqual(2);
    expect(sentApns.map((m) => m.token).sort()).toEqual([token("a"), token("b")]);
    expect(sentApns[0].payload.aps.alert.title).toBe("Plats prêts · Sur place n° 0007 · Hina");
  });

  it("appareil disparu (désinstallation, jeton d'un autre environnement) retiré ; autre erreur comptée", async () => {
    setApnsTransport(async (m) => (m.token === token("b") ? { ok: false, gone: true, error: "APNs 400 BadDeviceToken" } : { ok: false, gone: false, error: "APNs 500" }));
    try {
      await notifyDishReady({ organizationId: T.org.id, establishmentId: T.est.id, userId: T.owner.id }, { orderId: "00000000-0000-0000-0000-000000000002", items: [{ name: "Salade", quantity: 1, status: "READY" }], order: { number: "20261115-0008", type: "COUNTER", serverId: null, customerName: null, table: null } });
      expect(await prisma.apnsDevice.findUnique({ where: { token: token("b") } })).toBeNull();
      expect((await prisma.apnsDevice.findUniqueOrThrow({ where: { token: token("a") } })).failures).toBe(1);
    } finally {
      setApnsTransport(null);
    }
  });

  it("déconnexion : l'appareil est retiré pour la personne seulement", async () => {
    await unregisterApnsDevice(T.managerActor, token("a")); // pas le sien : rien ne change
    expect(await prisma.apnsDevice.findUnique({ where: { token: token("a") } })).not.toBeNull();
    await unregisterApnsDevice(T.actor, token("A"));
    expect(await prisma.apnsDevice.findUnique({ where: { token: token("a") } })).toBeNull();
  });

  it("charge utile : alerte, son, regroupement par commande et lien", () => {
    expect(apnsPayload({ title: "Plat prêt · Table T02", body: "Salade — à apporter", url: "/pos/order/x", tag: "ready-x", orderId: "x" })).toEqual({
      aps: { alert: { title: "Plat prêt · Table T02", body: "Salade — à apporter" }, sound: "default", "thread-id": "ready-x" }, url: "/pos/order/x", orderId: "x",
    });
  });
});

describe("Envoi réel en HTTP/2 vers un faux serveur APNs", () => {
  it("requête conforme à Apple (chemin, jeton, en-têtes, corps) ; réponses 200, 410 et BadDeviceToken comprises", async () => {
    const http2 = await import("node:http2");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const seen: { path: string; headers: Record<string, unknown>; body: string }[] = [];
    const server = http2.createServer();
    server.on("stream", (stream, headers) => {
      let body = "";
      stream.setEncoding("utf8");
      stream.on("data", (c: string) => { body += c; });
      stream.on("end", () => {
        const path = String(headers[":path"]);
        seen.push({ path, headers, body });
        if (path.endsWith(token("c"))) { stream.respond({ ":status": 200 }); stream.end(); }
        else if (path.endsWith(token("d"))) { stream.respond({ ":status": 410, "content-type": "application/json" }); stream.end(JSON.stringify({ reason: "Unregistered" })); }
        else { stream.respond({ ":status": 400, "content-type": "application/json" }); stream.end(JSON.stringify({ reason: "BadDeviceToken" })); }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const saved = { ...process.env };
    Object.assign(process.env, { APNS_ORIGIN: `http://127.0.0.1:${port}`, APNS_KEY_ID: "KEY1234567", APNS_TEAM_ID: "TEAM765432", APNS_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString().replace(/\n/g, "\\n"), APNS_BUNDLE_ID: "com.manaresto.caisse" });
    delete process.env.PUSH_TRANSPORT;
    try {
      for (const c of ["c", "d", "e"]) await registerApnsDevice(T.actor, { token: token(c), environment: "production" });
      await prisma.apnsDevice.deleteMany({ where: { token: { notIn: [token("c"), token("d"), token("e")] } } });
      await prisma.pushSubscription.deleteMany({});
      const r = await notifyDishReady({ organizationId: T.org.id, establishmentId: T.est.id, userId: T.owner.id }, { orderId: "00000000-0000-0000-0000-000000000003", items: [{ name: "Poisson cru", quantity: 1, status: "READY" }], order: { number: "20261115-0009", type: "DINE_IN", serverId: T.server.id, customerName: null, table: { name: "T05" } } });
      expect(r.sent).toBe(1);
      expect(seen).toHaveLength(3);
      const ok = seen.find((x) => x.path === `/3/device/${token("c")}`)!;
      expect(ok.headers["apns-topic"]).toBe("com.manaresto.caisse");
      expect(ok.headers["apns-push-type"]).toBe("alert");
      expect(ok.headers["apns-priority"]).toBe("10");
      expect(ok.headers["apns-collapse-id"]).toBe("ready-00000000-0000-0000-0000-000000000003");
      expect(String(ok.headers.authorization)).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
      expect(JSON.parse(ok.body)).toMatchObject({ aps: { alert: { title: "Plat prêt · Table T05" }, sound: "default" }, orderId: "00000000-0000-0000-0000-000000000003" });
      // 410 et BadDeviceToken : appareils retirés ; le bon reste
      expect((await prisma.apnsDevice.findMany({ select: { token: true } })).map((d) => d.token)).toEqual([token("c")]);
    } finally {
      process.env = saved;
      closeApnsSessions();
      await new Promise((r) => server.close(r));
    }
  });
});
