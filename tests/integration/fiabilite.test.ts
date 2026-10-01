import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { resetAttempts } from "@/server/auth/attempts";
import { createUser, updateUser } from "@/server/services/users";
import { setUserPin } from "@/server/services/auth";
import { identifyEmployee, upsertEmployee } from "@/server/services/staff";
import { setRecipe, upsertIngredient, addMovement } from "@/server/services/stock";
import { addItem, createOrder } from "@/server/services/orders";
import { addPayments, refundPayment } from "@/server/services/payments";
import { buildAccountingExport, buildExport } from "@/server/reports/export";
import { hashPin } from "@/server/auth/password";
import { addDays, localDay } from "@/lib/dates";

let T: Awaited<ReturnType<typeof makeTenant>>;
const TZ = "Pacific/Tahiti";

beforeAll(async () => {
  await resetDb();
  await resetAttempts();
  T = await makeTenant("fiabilite");
});

describe("PIN unique par établissement", () => {
  it("refuse un PIN déjà utilisé, à la création, à la modification et pour une fiche employé", async () => {
    const membership = [{ establishmentId: T.est.id, roleId: T.roles.server }];
    // 1001 = serveur, 2000 = manager, 9999 = propriétaire (jeu de test)
    await expect(createUser(T.org.id, T.manager.id, { email: "doublon@test.pf", password: "motdepasse1", firstName: "Dou", lastName: "Blon", pin: "1001", memberships: membership })).rejects.toMatchObject({ code: "PIN_TAKEN" });
    await expect(createUser(T.org.id, T.manager.id, { email: "proprio@test.pf", password: "motdepasse1", firstName: "Pro", lastName: "Prio", pin: "9999", memberships: membership })).rejects.toMatchObject({ code: "PIN_TAKEN" });
    const ok = await createUser(T.org.id, T.manager.id, { email: "nouveau@test.pf", password: "motdepasse1", firstName: "Nou", lastName: "Veau", pin: "4321", memberships: membership });
    await expect(setUserPin(ok.id, "2000")).rejects.toMatchObject({ code: "PIN_TAKEN" });
    await expect(updateUser(T.org.id, T.owner.id, ok.id, { pin: "1001" })).rejects.toMatchObject({ code: "PIN_TAKEN" });
    await setUserPin(ok.id, "4321"); // son propre PIN : accepté
    await expect(upsertEmployee(T.managerActor, { firstName: "Extra", lastName: "Plonge", pin: "2000" })).rejects.toMatchObject({ code: "PIN_TAKEN" });
    // La fiche employé du manager peut reprendre le PIN du manager lui-même
    await expect(upsertEmployee(T.managerActor, { firstName: "Manager", lastName: "Fiche", userId: T.manager.id, pin: "2000" })).resolves.toBeTruthy();
  });

  it("un PIN partagé (antérieur à la règle) n'identifie personne ; les conflits répétés sont limités", async () => {
    await resetAttempts();
    const h = await hashPin("5555");
    await prisma.employee.create({ data: { establishmentId: T.est.id, firstName: "A", lastName: "Doublon", pinHash: h } });
    await prisma.employee.create({ data: { establishmentId: T.est.id, firstName: "B", lastName: "Doublon", pinHash: h } });
    await expect(identifyEmployee(T.est.id, "5555")).rejects.toMatchObject({ code: "PIN_SHARED" });
    // Chercher un PIN pris pour deviner celui d'un collègue : 5 conflits par heure au plus
    for (let i = 0; i < 5; i++) await expect(setUserPin(T.server.id, "2000")).rejects.toMatchObject({ code: "PIN_TAKEN" });
    await expect(setUserPin(T.server.id, "2000")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await resetAttempts();
  });
});

describe("Stock des ventes encaissées sans passer par la cuisine", () => {
  it("décrémente les ingrédients à l'encaissement, une seule fois", async () => {
    const eauStock = await upsertIngredient(T.managerActor, { name: "Bouteille d'eau", unit: "pce" });
    await addMovement(T.managerActor, { ingredientId: eauStock.id, kind: "PURCHASE", quantity: 24, unitCost: 90 });
    await setRecipe(T.managerActor, T.eau.id, [{ ingredientId: eauStock.id, quantity: 1 }]);
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.eau.id, quantity: 3 });
    const res = await addPayments(T.actor, o.id, [{ method: "CARD", amount: 900 }]);
    expect(res.order.status).toBe("PAID");
    expect(res.order.items.every((i) => i.status === "SERVED")).toBe(true);
    const ing = await prisma.ingredient.findUniqueOrThrow({ where: { id: eauStock.id } });
    expect(Number(ing.stockQty)).toBe(21);
    expect(await prisma.inventoryMovement.count({ where: { ingredientId: eauStock.id, kind: "SALE" } })).toBe(1);
  });
});

describe("Export comptable et remboursements", () => {
  it("remboursement à sa date, TVA reprise, écritures équilibrées, CA net", async () => {
    const o = await createOrder(T.actor, { type: "COUNTER" });
    await addItem(T.actor, o.id, { productId: T.entree.id, quantity: 2 }); // 2 × 1 200 F, TVA 13 %
    await addItem(T.actor, o.id, { productId: T.biere.id, quantity: 1 }); // 600 F, TVA 16 %
    const paid = await addPayments(T.actor, o.id, [{ method: "CASH", amount: 3000, tendered: 5000 }]).catch(async (e) => {
      if (e?.code !== "NO_CASH_SESSION") throw e;
      const { openSession } = await import("@/server/services/cash");
      await openSession(T.managerActor, { openingFloat: 10000 });
      return addPayments(T.actor, o.id, [{ method: "CASH", amount: 3000, tendered: 5000 }]);
    });
    expect(paid.order.status).toBe("PAID");
    await refundPayment(T.managerActor, paid.payments[0].id, { amount: 1200, reason: "Plat non conforme" });

    const today = localDay(new Date(), TZ);
    const exp = await buildAccountingExport(T.est.id, addDays(today, -1), today, TZ);
    const sheet = (name: string) => exp.sheets.find((s) => s.name === name)!;
    const refunds = sheet("Remboursements");
    expect(refunds.rows).toHaveLength(1);
    expect(refunds.rows[0]).toEqual(expect.arrayContaining([o.number, "Espèces", 1200, "Plat non conforme"]));
    // Chaque journée est équilibrée (débit = crédit), remboursement compris
    const byDay = new Map<string, { d: number; c: number }>();
    for (const r of sheet("Écritures").rows) { const e = byDay.get(String(r[0])) ?? { d: 0, c: 0 }; e.d += Number(r[4]); e.c += Number(r[5]); byDay.set(String(r[0]), e); }
    for (const [, v] of byDay) expect(v.d).toBe(v.c);
    expect(sheet("Écritures").rows.some((r) => r[2] === "709000")).toBe(true);
    const journal = sheet("Journal de caisse").rows.find((r) => r[0] === today)!;
    expect(Number(journal[4])).toBe(1200);
    expect(Number(journal[5])).toBe(Number(journal[2]) - 1200);

    const period = await buildExport(T.est.id, "period", today, today, TZ);
    const net = period.sheets[0].rows.find((r) => r[0] === "CA TTC net des remboursements")!;
    const gross = period.sheets[0].rows.find((r) => r[0] === "CA TTC")!;
    expect(Number(net[1])).toBe(Number(gross[1]) - 1200);
  });
});
