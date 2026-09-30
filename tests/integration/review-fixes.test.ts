import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { addItem, applyDiscount, createOrder, getOrder, removeItem, sendCourse } from "@/server/services/orders";
import { addPayments, refundPayment } from "@/server/services/payments";
import { closeSession, openSession } from "@/server/services/cash";
import { getCustomerCard, upsertCustomer, adjustPoints } from "@/server/services/customers";
import { updateProduct, upsertModifierGroup } from "@/server/services/catalog";
import { assertCanAssign, assertCanGrant, assertCanManageUser, assertEmailAllowed } from "@/server/auth/guards";
import { reserveAttempt, resetAttempts } from "@/server/auth/attempts";
import { publicCatalog } from "@/server/services/public";
import { isPrivateAddress, assertPublicUrlShape } from "@/server/net/public-url";
import { redactSettings } from "@/server/services/establishments";

let A: Awaited<ReturnType<typeof makeTenant>>;
let B: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  process.env.PLATFORM_ADMIN_EMAILS = "admin@manaresto.com";
  await resetDb();
  A = await makeTenant("rev-a");
  B = await makeTenant("rev-b");
});

const ctxOf = async (userId: string, estId: string) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: { include: { role: { include: { permissions: true } } } } } });
  const perms = new Set<string>(user.isOwner ? ["*"] : user.memberships.flatMap((m) => m.role.permissions.map((p) => p.permissionKey)));
  return { user, permissions: perms, organizationId: user.organizationId, establishment: { id: estId } };
};

describe("Revue : comptes et droits", () => {
  it("un manager ne peut ni modifier le propriétaire, ni accorder plus que ses droits, ni affecter un autre établissement", async () => {
    const mgr = await ctxOf(A.manager.id, A.est.id);
    await expect(assertCanManageUser(mgr, A.owner.id)).rejects.toMatchObject({ status: 403, code: "OWNER" });
    await expect(assertCanManageUser(mgr, A.server.id)).resolves.toBeUndefined();
    expect(() => assertCanGrant(mgr, ["establishments.manage"])).toThrow(/droits que vous n'avez pas/);
    await expect(assertCanAssign(mgr, [{ establishmentId: B.est.id, roleId: A.roles.server }])).rejects.toMatchObject({ status: 403 });
    await expect(assertCanAssign(mgr, [{ establishmentId: A.est.id, roleId: A.roles.server }])).resolves.toBeUndefined();
    const owner = await ctxOf(A.owner.id, A.est.id);
    await expect(assertCanManageUser(owner, A.manager.id)).resolves.toBeUndefined();
  });

  it("les adresses des administrateurs de la plateforme sont réservées", () => {
    expect(() => assertEmailAllowed("Admin@ManaResto.com")).toThrow(/réservée/);
    expect(() => assertEmailAllowed("admin@manaresto.com", "admin@manaresto.com")).not.toThrow();
    expect(() => assertEmailAllowed("quelqu.un@test.pf")).not.toThrow();
  });

  it("tentatives de PIN : réservées avant vérification, un succès ne libère que sa propre tentative", () => {
    resetAttempts();
    for (let i = 0; i < 3; i++) reserveAttempt("pin:x", 3, 60_000);
    expect(() => reserveAttempt("pin:x", 3, 60_000)).toThrow(/Trop de tentatives/);
    resetAttempts();
    const r1 = reserveAttempt("pin:y", 2, 60_000);
    reserveAttempt("pin:y", 2, 60_000); // échec d'un autre
    r1(); // succès : libère seulement sa tentative
    reserveAttempt("pin:y", 2, 60_000);
    expect(() => reserveAttempt("pin:y", 2, 60_000)).toThrow();
    resetAttempts();
  });
});

describe("Revue : isolation entre restaurants", () => {
  it("variantes et options d'un autre restaurant ne sont pas modifiables", async () => {
    const vb = await prisma.productVariant.create({ data: { productId: B.burger.id, name: "XL", priceTtc: 2500 } });
    await expect(updateProduct(A.managerActor, A.burger.id, { variants: [{ id: vb.id, name: "pirate", priceTtc: 0 }] })).rejects.toMatchObject({ code: "BAD_VARIANT" });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: vb.id } })).priceTtc).toBe(2500);
    const modB = await prisma.modifier.findFirstOrThrow({ where: { groupId: B.supp.id } });
    await expect(upsertModifierGroup(A.managerActor, { id: A.supp.id, name: "Suppléments", minSelect: 0, maxSelect: null, modifiers: [{ id: modB.id, name: "pirate", priceDelta: 0 }] })).rejects.toMatchObject({ code: "BAD_MODIFIER" });
  });

  it("une fiche client d'une autre entreprise est introuvable", async () => {
    const c = await upsertCustomer(B.managerActor, { firstName: "Secret", phone: "87000001" });
    await expect(getCustomerCard(A.est.id, c.id)).rejects.toMatchObject({ status: 404 });
    await expect(getCustomerCard(B.est.id, c.id)).resolves.toMatchObject({ firstName: "Secret" });
  });

  it("le catalogue public ne contient aucun prix de revient, y compris dans les formules", async () => {
    const pub = await publicCatalog(A.est.id);
    expect(pub.menus.length).toBeGreaterThan(0);
    expect(JSON.stringify(pub)).not.toContain("costPrice");
  });

  it("secrets masqués et adresses internes refusées", () => {
    expect(redactSettings({ payments: { terminal: { adapter: "bridge", apiKey: "sk_live_x" } } })).toEqual({ payments: { terminal: { adapter: "bridge", apiKey: "••••" } } });
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("172.18.0.3")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(() => assertPublicUrlShape("http://localhost:3000/x")).toThrow(/interne/);
    expect(() => assertPublicUrlShape("http://127.0.0.1/")).toThrow(/interne/);
    expect(() => assertPublicUrlShape("https://hooks.exemple.pf/x")).not.toThrow();
  });
});

describe("Revue : encaissements et envois simultanés", () => {
  it("deux encaissements simultanés ne dépassent pas le reste dû", async () => {
    const o = await createOrder(A.actor, { type: "TAKEAWAY" });
    await addItem(A.actor, o.id, { productId: A.biere.id, quantity: 1 }); // 600
    const results = await Promise.allSettled([
      addPayments(A.actor, o.id, [{ method: "CARD", amount: 600 }]),
      addPayments(A.actor, o.id, [{ method: "CARD", amount: 600 }]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const after = await getOrder(A.est.id, o.id);
    expect(after.paidTotal).toBe(600);
    expect(after.status).toBe("PAID");
  });

  it("un double envoi en cuisine ne crée qu'un seul ticket", async () => {
    const o = await createOrder(A.actor, { type: "TAKEAWAY" });
    await addItem(A.actor, o.id, { productId: A.biere.id, quantity: 1 });
    const results = await Promise.allSettled([sendCourse(A.actor, o.id, { all: true }), sendCourse(A.actor, o.id, { all: true })]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await prisma.kitchenTicket.count({ where: { orderId: o.id } })).toBe(1);
  });

  it("deux remboursements simultanés ne dépassent pas le paiement", async () => {
    const o = await createOrder(A.actor, { type: "TAKEAWAY" });
    await addItem(A.actor, o.id, { productId: A.biere.id, quantity: 1 });
    const { payments } = await addPayments(A.actor, o.id, [{ method: "CARD", amount: 600 }]);
    const results = await Promise.allSettled([
      refundPayment(A.managerActor, payments[0].id, { amount: 600, reason: "test" }),
      refundPayment(A.managerActor, payments[0].id, { amount: 600, reason: "test" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await prisma.refund.count({ where: { paymentId: payments[0].id } })).toBe(1);
  });

  it("après un paiement partiel, le total ne peut pas passer sous le déjà payé ; une addition 100 % offerte est close", async () => {
    const o = await createOrder(A.actor, { type: "TAKEAWAY" });
    await addItem(A.actor, o.id, { productId: A.biere.id, quantity: 1 }); // 600
    await addItem(A.actor, o.id, { productId: A.eau.id, quantity: 1 });   // 300
    await addPayments(A.actor, o.id, [{ method: "CARD", amount: 700 }]);
    const eau = (await getOrder(A.est.id, o.id)).items.find((i) => i.name === "Eau")!;
    await expect(removeItem(A.managerActor, o.id, eau.id)).rejects.toMatchObject({ code: "BELOW_PAID" });
    const o2 = await createOrder(A.actor, { type: "TAKEAWAY" });
    await addItem(A.actor, o2.id, { productId: A.biere.id, quantity: 1 });
    await applyDiscount(A.managerActor, o2.id, { percentBps: 10_000, reason: "Offert" });
    expect((await getOrder(A.est.id, o2.id)).status).toBe("PAID");
  });

  it("caisse : double ouverture refusée, points jamais négatifs", async () => {
    const actor = { ...A.managerActor, terminalId: null };
    const r = await Promise.allSettled([openSession(actor, { openingFloat: 0 }), openSession(actor, { openingFloat: 0 })]);
    expect(r.filter((x) => x.status === "fulfilled").length).toBe(1);
    const s = await prisma.cashSession.findFirstOrThrow({ where: { establishmentId: A.est.id, status: "OPEN" } });
    await closeSession(actor, s.id, { countedCash: 0 });
    const c = await upsertCustomer(A.managerActor, { firstName: "Fidèle", phone: "87000002" });
    await adjustPoints(A.managerActor, c.id, 50, "bonus");
    await expect(adjustPoints(A.managerActor, c.id, -500, "retrait")).rejects.toMatchObject({ code: "NOT_ENOUGH_POINTS" });
  });
});
