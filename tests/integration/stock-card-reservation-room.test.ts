import { beforeAll, describe, expect, it } from "vitest";
import { resetDb } from "../setup/db";
import { makeTenant } from "../setup/fixtures";
import { listIngredients, listMovements, upsertIngredient } from "@/server/services/stock";
import { listReservations, upsertReservation } from "@/server/services/reservations";
import { localDay } from "@/lib/dates";
import { upsertRoom, upsertTable } from "@/server/services/floor";

let T: Awaited<ReturnType<typeof makeTenant>>;

beforeAll(async () => {
  await resetDb();
  T = await makeTenant("fiche-stock");
});

describe("Fiche ingrédient : quantité en stock saisie directement", () => {
  it("le stock de départ est pris à la création, et une correction depuis la fiche est tracée en inventaire", async () => {
    const riz = await upsertIngredient(T.managerActor, { name: "Riz", unit: "kg", stockQty: 25, stockMin: 5, avgCost: 180 });
    expect(Number(riz.stockQty)).toBe(25);
    let moves = await listMovements(T.est.id, { ingredientId: riz.id });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: "INVENTORY", quantity: 25, unitCost: 180, reason: "Stock de départ" });
    expect((await listIngredients(T.est.id)).find((i) => i.id === riz.id)!.value).toBe(4500);
    // Modification de la fiche sans toucher au stock : aucun mouvement
    await upsertIngredient(T.managerActor, { id: riz.id, name: "Riz basmati", unit: "kg", stockQty: 25 });
    expect(await listMovements(T.est.id, { ingredientId: riz.id })).toHaveLength(1);
    // Correction du stock depuis la fiche : l'écart est tracé
    const after = await upsertIngredient(T.managerActor, { id: riz.id, name: "Riz basmati", unit: "kg", stockQty: 22.5 });
    expect(Number(after.stockQty)).toBe(22.5);
    moves = await listMovements(T.est.id, { ingredientId: riz.id });
    expect(moves[0]).toMatchObject({ kind: "INVENTORY", quantity: -2.5, reason: "Stock corrigé depuis la fiche" });
    // Sans stock de départ : zéro, aucun mouvement
    const sel = await upsertIngredient(T.managerActor, { name: "Sel", unit: "g" });
    expect(Number(sel.stockQty)).toBe(0);
    expect(await listMovements(T.est.id, { ingredientId: sel.id })).toHaveLength(0);
  });
});

describe("Réservations : la table avec sa salle", () => {
  it("la réservation porte le nom de la salle de sa table, et le conflit le cite", async () => {
    const terrasse = await upsertRoom(T.managerActor, { name: "Terrasse" });
    const t1Terrasse = await upsertTable(T.managerActor, { roomId: terrasse.id, name: "T01", seats: 4 }); // même numéro que T01 de la salle
    const when = new Date(Date.now() + 2 * 86_400_000);
    const startsAt = when.toISOString();
    const r = await upsertReservation(T.managerActor, { name: "Hina", startsAt, partySize: 2, tableId: t1Terrasse.id });
    expect(r.table).toMatchObject({ name: "T01", room: { name: "Terrasse" } });
    const listed = (await listReservations(T.est.id, localDay(when, "Pacific/Tahiti"), "Pacific/Tahiti")).find((x) => x.id === r.id)!;
    expect(listed.table?.room.name).toBe("Terrasse");
    // La T01 de la salle principale reste libre au même moment ; la T01 de la terrasse est prise, et le message le dit
    await expect(upsertReservation(T.managerActor, { name: "Teva", startsAt, partySize: 2, tableId: T.t1.id })).resolves.toBeTruthy();
    await expect(upsertReservation(T.managerActor, { name: "Moana", startsAt, partySize: 2, tableId: t1Terrasse.id })).rejects.toMatchObject({ code: "TABLE_TAKEN", message: expect.stringContaining("T01 (Terrasse)") });
  });
});
