import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";

// Cookies et en-têtes de la requête simulés (session ouverte par PIN, terminal)
const jar = new Map<string, string>();
const hdrs = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => { jar.set(n, v); },
    delete: (n: string) => { jar.delete(n); },
  }),
  headers: async () => ({ get: (n: string) => hdrs.get(n.toLowerCase()) ?? null }),
}));

const { prisma } = await import("@/server/db");
const { loginWithPin } = await import("@/server/services/auth");
const { getAuthContext } = await import("@/server/auth/context");
const { assertPinAvailable } = await import("@/server/services/pin-unique");
const { assertCanManageUser } = await import("@/server/auth/guards");
const { createOrder, addItem } = await import("@/server/services/orders");
const { rejectOnlineOrder } = await import("@/server/services/public");
const { createBox, isTrustedOfflineReplay } = await import("@/server/box/boxes");
const { chargeOnTerminal, setTerminalFetcher } = await import("@/server/hardware/payment-terminal");
const { isKnownPushService } = await import("@/server/push");
const { ipRateKey } = await import("@/server/rate-limit");
const { parseBody } = await import("@/server/http");
const { createApiKey, requireApiKey } = await import("@/server/api-keys");
const { z } = await import("zod");

let T: Awaited<ReturnType<typeof makeTenant>>;
let O: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("audit");
  O = await makeTenant("autre");
});

describe("audit de sécurité : connexion par PIN", () => {
  it("le PIN du propriétaire ouvre la caisse, jamais l'administration (comptes, rôles, réglages)", async () => {
    jar.clear();
    await loginWithPin(T.est.id, "9999", null, T.owner.id);
    const session = await prisma.session.findFirstOrThrow({ where: { userId: T.owner.id }, orderBy: { createdAt: "desc" } });
    expect(session.scope).toBe("pin");
    const ctx = (await getAuthContext())!;
    expect(ctx.user.id).toBe(T.owner.id);
    expect(ctx.user.isOwner).toBe(false); // actions réservées au propriétaire : mot de passe exigé
    for (const p of ["users.manage", "settings.manage", "establishments.manage"]) expect(ctx.permissions.has(p)).toBe(false);
    for (const p of ["pos.use", "pos.refund", "catalog.manage", "reports.view"]) expect(ctx.permissions.has(p)).toBe(true);
    jar.clear();
  });

  it("découvrir les PIN des collègues en essayant « PIN déjà pris » : chaque essai compte", async () => {
    const opts = { establishmentIds: [T.est.id], userId: T.server.id, guardKey: `sonde-${T.server.id}` };
    for (let i = 0; i < 30; i++) await assertPinAvailable(String(5000 + i), opts); // PIN libres : comptés aussi
    await expect(assertPinAvailable("5100", opts)).rejects.toMatchObject({ status: 429 });
  });

  it("un gérant ne modifie pas un membre qui travaille aussi dans un autre établissement", async () => {
    const est2 = await prisma.establishment.create({ data: { organizationId: T.org.id, name: "Second", slug: "second-audit" } });
    const both = await prisma.user.create({ data: { organizationId: T.org.id, email: "deux-etabs@test.pf", passwordHash: "x", firstName: "Deux", lastName: "Etabs", memberships: { create: [{ establishmentId: T.est.id, roleId: T.roles.server }, { establishmentId: est2.id, roleId: T.roles.manager }] } } });
    const managerCtx = { user: T.manager, organizationId: T.org.id, establishment: { id: T.est.id }, permissions: new Set(["*"]) };
    await expect(assertCanManageUser(managerCtx as never, both.id)).rejects.toMatchObject({ code: "OTHER_ESTABLISHMENT" });
    await expect(assertCanManageUser(managerCtx as never, T.server.id)).resolves.toBeUndefined();
  });
});

describe("audit de sécurité : fraudes à la caisse", () => {
  it("« refuser une commande en ligne » ne sert plus à annuler une table", async () => {
    const o = await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 2 });
    await addItem(T.actor, o.id, { productId: T.biere.id, courseId: o.courses[0].id });
    await expect(rejectOnlineOrder(T.actor, o.id, "test")).rejects.toMatchObject({ code: "NOT_REJECTABLE" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).not.toBe("CANCELLED");
  });

  it("rejeu hors ligne : reconnu seulement avec la clé d'un boîtier de cet établissement", async () => {
    const box = await createBox({ ...T.actor, userId: T.owner.id }, { name: "Boîtier" });
    const other = await createBox({ ...O.actor, userId: O.owner.id }, { name: "Boîtier B" });
    const req = (h: Record<string, string>) => new NextRequest("http://localhost/api/orders/x/payments", { method: "POST", headers: h });
    expect(await isTrustedOfflineReplay(req({ "x-offline-replay": "1" }), T.est.id)).toBe(false);
    expect(await isTrustedOfflineReplay(req({ "x-offline-replay": "1", "x-box-key": other.key }), T.est.id)).toBe(false);
    expect(await isTrustedOfflineReplay(req({ "x-box-key": box.key }), T.est.id)).toBe(false);
    expect(await isTrustedOfflineReplay(req({ "x-offline-replay": "1", "x-box-key": box.key }), T.est.id)).toBe(true);
  });
});

describe("audit de sécurité : requêtes vers le réseau interne", () => {
  it("passerelle TPE pointée vers une adresse interne : jamais appelée", async () => {
    setTerminalFetcher(null);
    const o = await createOrder(T.actor, { type: "TAKEAWAY" });
    await addItem(T.actor, o.id, { productId: T.biere.id, courseId: o.courses[0].id });
    for (const url of ["http://127.0.0.1:6379/x?#", "http://169.254.169.254/latest", "https://localhost/x", "http://db:5432/"]) {
      await prisma.establishment.update({ where: { id: T.est.id }, data: { settings: { payments: { terminal: { adapter: "bridge", url } } } } });
      await expect(chargeOnTerminal(T.actor, o.id, 600)).rejects.toMatchObject({ code: "TERMINAL_DECLINED", message: expect.stringMatching(/interne|refusée/) });
    }
  });

  it("notifications web : seulement les services des navigateurs", () => {
    expect(isKnownPushService("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isKnownPushService("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isKnownPushService("https://web.push.apple.com/abc")).toBe(true);
    expect(isKnownPushService("https://internal-host/abc")).toBe(false);
    expect(isKnownPushService("https://fcm.googleapis.com.evil.io/x")).toBe(false);
    expect(isKnownPushService("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isKnownPushService("http://fcm.googleapis.com/x")).toBe(false);
  });
});

describe("audit de sécurité : limites et options", () => {
  it("IPv6 : les limites portent sur le préfixe /64", () => {
    expect(ipRateKey("2a0a:4cc0:c1:e079:68c3:a9ff:fe57:c657")).toBe(ipRateKey("2a0a:4cc0:c1:e079::1"));
    expect(ipRateKey("2a0a:4cc0:c1:e079::1")).not.toBe(ipRateKey("2a0a:4cc0:c1:e07a::1"));
    expect(ipRateKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipRateKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("envoi géant refusé avant d'être lu en entier", async () => {
    const big = new NextRequest("http://localhost/api/public/x", { method: "POST", body: JSON.stringify({ a: "x".repeat(5 * 1024 * 1024) }), headers: { "content-type": "application/json" } });
    await expect(parseBody(big, z.object({ a: z.string() }))).rejects.toMatchObject({ status: 413 });
    const ok = new NextRequest("http://localhost/api/public/x", { method: "POST", body: JSON.stringify({ a: "y" }) });
    await expect(parseBody(ok, z.object({ a: z.string() }))).resolves.toEqual({ a: "y" });
  });

  it("clé d'API inutilisable une fois l'option « Avancé » arrêtée", async () => {
    const k = await createApiKey(T.managerActor, { name: "Compta", scopes: ["orders:read"] });
    const req = () => new NextRequest("http://localhost/api/v1/orders", { headers: { authorization: `Bearer ${k.key}` } });
    await expect(requireApiKey(req(), "orders:read")).resolves.toMatchObject({ establishmentId: T.est.id });
    const options = T.org.options.filter((o) => o !== "advanced");
    await prisma.organization.update({ where: { id: T.org.id }, data: { options } });
    await expect(requireApiKey(req(), "orders:read")).rejects.toMatchObject({ code: "OPTION_REQUIRED" });
    await prisma.organization.update({ where: { id: T.org.id }, data: { options: T.org.options } });
  });
});
