import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { prisma } from "@/server/db";
import { setProductsTaxRate } from "@/server/services/catalog";
import { addItem, createOrder } from "@/server/services/orders";

let T: Awaited<ReturnType<typeof makeTenant>>;
let U: Awaited<ReturnType<typeof makeTenant>>;
beforeAll(async () => {
  await resetDb();
  T = await makeTenant("tva");
  U = await makeTenant("tva-autre");
});

describe("TVA du catalogue", () => {
  it("change la TVA d'une sélection, d'une catégorie ou de toute la carte ; les commandes passées gardent leur taux", async () => {
    const o = await createOrder(T.actor, { type: "TAKEAWAY" });
    await addItem(T.actor, o.id, { productId: T.biere.id, quantity: 1 });
    expect((await setProductsTaxRate(T.managerActor, { productIds: [T.biere.id], taxRateId: T.tax13.id })).updated).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: T.biere.id } })).taxRateId).toBe(T.tax13.id);
    expect((await prisma.orderItem.findFirstOrThrow({ where: { orderId: o.id } })).taxRateBps).toBe(1600); // déjà commandée : taux d'origine
    const all = await setProductsTaxRate(T.managerActor, { categoryId: T.cat.id, taxRateId: T.tax16.id });
    expect(all.updated).toBeGreaterThanOrEqual(4);
    expect(await prisma.product.count({ where: { establishmentId: T.est.id, categoryId: T.cat.id, taxRateId: { not: T.tax16.id } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "product.tax_rate.bulk" } })).toBe(2);
  });

  it("refuse un taux d'un autre restaurant et une demande sans cible ; n'agit que sur son restaurant", async () => {
    await expect(setProductsTaxRate(T.managerActor, { all: true, taxRateId: U.tax13.id })).rejects.toMatchObject({ code: "BAD_TAX_RATE" });
    await expect(setProductsTaxRate(T.managerActor, { taxRateId: T.tax0.id })).rejects.toMatchObject({ code: "NO_TARGET" });
    await setProductsTaxRate(T.managerActor, { productIds: [U.biere.id], taxRateId: T.tax0.id });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: U.biere.id } })).taxRateId).toBe(U.tax16.id);
  });
});
