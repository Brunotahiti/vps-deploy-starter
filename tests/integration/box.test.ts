import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { NextRequest } from "next/server";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, createOrder } from "@/server/services/orders";
import { addPayments } from "@/server/services/payments";
import { openSession } from "@/server/services/cash";
import { createInvoice, upsertAccount } from "@/server/services/accounts";
import { sellGiftCard } from "@/server/services/marketing";
import { exportSnapshot, importSnapshot, BOX_TABLES } from "@/server/box/snapshot";
import { createBox, openBoxSession, requireBox, requireBoxSecret, revokeBox } from "@/server/box/boxes";
import { sha256 } from "@/server/auth/password";
import { kitchenTicketId } from "@/server/services/orders";

let T: Awaited<ReturnType<typeof makeTenant>>;
let U: Awaited<ReturnType<typeof makeTenant>>;
let boxDb: PrismaClient;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("box");
  U = await makeTenant("box-voisin");
  // Base du boîtier : même schéma, base distincte
  const url = process.env.DATABASE_URL!.replace(/\/manaresto_test(\?|$)/, "/manaresto_box_test$1");
  execSync("npx prisma migrate deploy", { stdio: "ignore", env: { ...process.env, DATABASE_URL: url } });
  boxDb = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}, 120_000);
afterAll(async () => { await boxDb?.$disconnect(); });

describe("boîtier de secours : copie du restaurant", () => {
  it("le boîtier reçoit tout ce qu'il faut pour le service, et rien des autres restaurants", async () => {
    await openSession(T.managerActor, { openingFloat: 5000 });
    const o = await addItem(T.actor, (await createOrder(T.actor, { type: "DINE_IN", tableId: T.t1.id, covers: 2 })).id, { productId: T.biere.id });
    const paid = await addItem(T.actor, (await createOrder(T.actor, { type: "COUNTER" })).id, { productId: T.biere.id });
    await addPayments(T.actor, paid.id, [{ method: "CASH", amount: paid.total }]);
    // Options : addition « Sur compte » d'un client pro (facturée) et payée par carte cadeau (les paiements y renvoient)
    const account = await upsertAccount(T.managerActor, { name: "Entreprise du boîtier" });
    const onAccount = await addItem(T.actor, (await createOrder(T.actor, { type: "COUNTER" })).id, { productId: T.eau.id });
    await addPayments(T.actor, onAccount.id, [{ method: "ACCOUNT", amount: onAccount.total, customerAccountId: account.id }]);
    await createInvoice(T.managerActor, account.id);
    const card = await sellGiftCard(T.managerActor, { amount: 5000, method: "CARD" });
    const byCard = await addItem(T.actor, (await createOrder(T.actor, { type: "COUNTER" })).id, { productId: T.eau.id });
    await addPayments(T.actor, byCard.id, [{ method: "GIFT_CARD", amount: byCard.total, giftCardCode: card.code }]);
    await createOrder(U.actor, { type: "COUNTER" });

    // Une invitation en attente et un membre d'un autre établissement de la même entreprise
    await prisma.user.update({ where: { id: T.server.id }, data: { inviteToken: "jeton-invitation-secret" } });
    const est2 = await prisma.establishment.create({ data: { organizationId: T.org.id, name: "Autre resto", slug: "autre-resto-box" } });
    const other = await prisma.user.create({ data: { organizationId: T.org.id, email: "ailleurs@test.pf", passwordHash: "hash-ailleurs", pinHash: "pin-ailleurs", firstName: "Ailleurs", lastName: "X", memberships: { create: { establishmentId: est2.id, roleId: T.roles.server } } } });

    const snap = await exportSnapshot(prisma, T.est.id);
    expect(Object.keys(snap.tables)).toEqual(BOX_TABLES.map((t) => t.table));
    // Le boîtier ne reçoit que de quoi se connecter dans SON établissement
    const users = snap.tables.users as { id: string; email: string; password_hash: string; pin_hash: string | null; invite_token: string | null }[];
    const byId = (id: string) => users.find((u) => u.id === id)!;
    expect(JSON.stringify(snap)).not.toContain("jeton-invitation-secret");
    expect(byId(T.owner.id).password_hash).toBe("!"); // jamais le mot de passe du propriétaire
    expect(byId(T.owner.id).pin_hash).toBeTruthy(); // son PIN reste utilisable (session limitée à la caisse)
    expect(byId(other.id)).toMatchObject({ password_hash: "!", pin_hash: null, email: `${other.id}@absent.invalid` });
    expect(byId(T.server.id).password_hash).not.toBe("!");
    expect((snap.tables.establishments as { id: string }[]).map((e) => e.id)).toEqual([T.est.id]);
    expect(JSON.stringify(snap.tables.user_establishments)).not.toContain(est2.id);
    expect(snap.tables.organizations).toHaveLength(1);
    expect((snap.tables.orders as { id: string }[]).map((x) => x.id).sort()).toEqual([o.id, paid.id, onAccount.id, byCard.id].sort());
    expect(JSON.stringify(snap)).not.toContain(U.est.id);

    const counts = await importSnapshot(boxDb, snap);
    expect(counts.orders).toBe(4);
    expect((await boxDb.payment.findFirstOrThrow({ where: { orderId: onAccount.id } })).customerAccountId).toBe(account.id);
    expect((await boxDb.giftCard.findUniqueOrThrow({ where: { id: card.id } })).balance).toBe(5000 - byCard.total);
    // Même commande, mêmes montants, même équipe (le PIN marche sur le boîtier)
    const local = await boxDb.order.findUniqueOrThrow({ where: { id: o.id }, include: { items: true } });
    expect(local.total).toBe(o.total);
    expect(local.items).toHaveLength(1);
        expect((await boxDb.user.findUniqueOrThrow({ where: { id: T.server.id } })).pinHash).toBe((await prisma.user.findUniqueOrThrow({ where: { id: T.server.id } })).pinHash);
    expect(await boxDb.product.count()).toBe(await prisma.product.count({ where: { establishmentId: T.est.id } }));
    expect(await boxDb.cashSession.count({ where: { status: "OPEN" } })).toBe(1);
    expect((await boxDb.payment.findFirstOrThrow({ where: { orderId: paid.id } })).amount).toBe(paid.total);
    expect(await boxDb.establishment.count({ where: { id: U.est.id } })).toBe(0);
  });

  it("une nouvelle copie remplace la précédente ; une copie d'une autre version est refusée sans rien toucher", async () => {
    await createOrder(T.actor, { type: "TAKEAWAY" });
    const snap = await exportSnapshot(prisma, T.est.id);
    expect((await importSnapshot(boxDb, snap)).orders).toBe(5);
    expect(await boxDb.order.count()).toBe(5);

    // Caisse ouverte depuis plusieurs jours : la vente ancienne n'est pas copiée, son mouvement garde le montant sans le lien
    const old = await addItem(T.actor, (await createOrder(T.actor, { type: "COUNTER" })).id, { productId: T.eau.id });
    await addPayments(T.actor, old.id, [{ method: "CASH", amount: old.total }]);
    await prisma.order.update({ where: { id: old.id }, data: { openedAt: new Date(Date.now() - 3 * 86400_000) } });
    const older = await exportSnapshot(prisma, T.est.id);
    expect((await importSnapshot(boxDb, older)).orders).toBe(5);
    const mv = await boxDb.cashMovement.findFirstOrThrow({ where: { amount: old.total, kind: "SALE", orderId: null } });
    expect(mv.paymentId).toBeNull();

    await expect(importSnapshot(boxDb, { ...snap, schema: "20990101000000_futur", tables: { ...snap.tables, orders: [] } })).rejects.toThrow(/mettez le boîtier à jour/);
    expect(await boxDb.order.count()).toBe(5);
  });

  it("clé du boîtier : affichée une fois, limitée à son restaurant, inutilisable une fois retiré", async () => {
    const box = await createBox(T.managerActor, { name: "Boîtier caisse" });
    expect(box.key).toMatch(/^mrbox_/);
    expect(JSON.stringify(await prisma.localBox.findUniqueOrThrow({ where: { id: box.id } }))).not.toContain(box.key);
    const req = (key: string) => new NextRequest("http://localhost/api/box/snapshot", { headers: { authorization: `Bearer ${key}`, "x-box-lan-ip": "192.168.1.20", "x-box-version": "1.0.0" } });
    expect((await requireBox(req(box.key))).establishmentId).toBe(T.est.id);
    await expect(requireBox(req("mrbox_inconnue"))).rejects.toMatchObject({ status: 401 });
    await expect.poll(async () => (await prisma.localBox.findUniqueOrThrow({ where: { id: box.id } })).lanIp).toBe("192.168.1.20");

    // Sans l'option Continuité de service, le boîtier est en pause
    const before = (await prisma.organization.findUniqueOrThrow({ where: { id: T.org.id } })).options;
    await prisma.organization.update({ where: { id: T.org.id }, data: { options: before.filter((o) => o !== "continuity") } });
    await expect(requireBox(req(box.key))).rejects.toMatchObject({ status: 403, code: "OPTION_REQUIRED" });
    await prisma.organization.update({ where: { id: T.org.id }, data: { options: before } });

    await revokeBox(T.managerActor, box.id);
    await expect(requireBox(req(box.key))).rejects.toMatchObject({ status: 401 });
    await expect(revokeBox(U.managerActor, box.id)).rejects.toMatchObject({ status: 404 });
  });

  it("connexion faite sur le boîtier pendant la coupure : session du cloud pour la même personne, sur son terminal", async () => {
    const box = await createBox(T.managerActor, { name: "Boîtier salle" });
    const terminal = await prisma.terminal.create({ data: { establishmentId: T.est.id, name: "Tablette", kind: "POS", deviceKeyHash: sha256("tablette-box") } });
    const req = new NextRequest("http://localhost/api/box/sessions", { method: "POST", headers: { authorization: `Bearer ${box.key}`, cookie: "mr_terminal=tablette-box" } });
    const s = await openBoxSession(req, await requireBox(req), T.server.id);
    const row = await prisma.session.findUniqueOrThrow({ where: { tokenHash: sha256(s.token) } });
    expect(row).toMatchObject({ userId: T.server.id, establishmentId: T.est.id, terminalId: terminal.id, scope: "pos", boxId: box.id });
    expect(s.maxAge).toBeGreaterThan(3600);
    expect(s.maxAge).toBeLessThanOrEqual(12 * 3600);
    // Même le propriétaire n'obtient qu'une session « caisse »
    const ownerSession = await openBoxSession(req, await requireBox(req), T.owner.id);
    expect((await prisma.session.findUniqueOrThrow({ where: { tokenHash: sha256(ownerSession.token) } })).scope).toBe("pos");
    // Jamais pour un compte d'un autre restaurant, jamais sans tablette enregistrée de l'établissement
    await expect(openBoxSession(req, await requireBox(req), U.server.id)).rejects.toMatchObject({ status: 404 });
    const noTerminal = new NextRequest("http://localhost/api/box/sessions", { method: "POST", headers: { authorization: `Bearer ${box.key}` } });
    await expect(openBoxSession(noTerminal, await requireBox(noTerminal), T.server.id)).rejects.toMatchObject({ status: 403 });
    // Boîtier retiré : ses sessions disparaissent avec lui
    await revokeBox(T.managerActor, box.id);
    expect(await prisma.session.count({ where: { boxId: box.id } })).toBe(0);
  });

  it("même envoi en cuisine, même bon : l'id ne dépend que des articles envoyés", () => {
    const a = "6f1c1d0e-8a51-4c51-9b8e-0e5b8e8f1a01", b = "6f1c1d0e-8a51-4c51-9b8e-0e5b8e8f1a02";
    expect(kitchenTicketId([a, b])).toBe(kitchenTicketId([b, a]));
    expect(kitchenTicketId([a])).not.toBe(kitchenTicketId([a, b]));
    expect(kitchenTicketId([a])).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("le remplacement de la base n'existe que sur un boîtier, avec son secret", () => {
    const req = new NextRequest("http://localhost/api/box/import", { method: "POST", headers: { "x-box-secret": "x".repeat(32) } });
    expect(() => requireBoxSecret(req)).toThrow(expect.objectContaining({ status: 404 }));
    process.env.BOX_MODE = "1";
    process.env.BOX_SECRET = "x".repeat(32);
    try {
      expect(() => requireBoxSecret(req)).not.toThrow();
      expect(() => requireBoxSecret(new NextRequest("http://localhost/api/box/import", { method: "POST", headers: { "x-box-secret": "y".repeat(32) } }))).toThrow(expect.objectContaining({ status: 401 }));
    } finally {
      delete process.env.BOX_MODE;
      delete process.env.BOX_SECRET;
    }
  });
});
