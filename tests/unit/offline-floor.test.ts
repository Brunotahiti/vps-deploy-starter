import { describe, expect, it } from "vitest";
import { applyFloorOverrides } from "@/lib/offline/local-orders";
import type { FloorStatus } from "@/components/pos/types";

const table = (id: string, status: string, orderId: string | null) => ({ id, name: id, status, order: orderId ? { id: orderId } : null, serverInitials: orderId ? "MO" : null, serverColor: null, service: null });
const floor = (tables: ReturnType<typeof table>[]) => ({ rooms: [{ id: "r", name: "Salle", tables }] }) as unknown as FloorStatus;
const status = (f: FloorStatus) => f.rooms[0].tables.map((t) => [t.id, t.status, t.order?.id ?? null]);

describe("plan de salle pendant une coupure", () => {
  const f = floor([table("T1", "SENT", "o1"), table("T2", "TO_CLEAN", null), table("T3", "ORDERING", "o3")]);

  it("sans opération en attente, le plan est inchangé", () => {
    expect(applyFloorOverrides(f, { closedOrders: [], freedTables: [] }, false)).toBe(f);
  });

  it("une table encaissée sur cet appareil se libère, même si le serveur la voit encore occupée", () => {
    expect(status(applyFloorOverrides(f, { closedOrders: ["o1"], freedTables: [] }, false))).toEqual([["T1", "FREE", null], ["T2", "TO_CLEAN", null], ["T3", "ORDERING", "o3"]]);
    // Réglage « tables à nettoyer après paiement »
    expect(status(applyFloorOverrides(f, { closedOrders: ["o1"], freedTables: [] }, true))[0]).toEqual(["T1", "TO_CLEAN", null]);
  });

  it("une table nettoyée hors ligne redevient libre", () => {
    expect(status(applyFloorOverrides(f, { closedOrders: [], freedTables: ["T2"] }, false))[1]).toEqual(["T2", "FREE", null]);
  });
});
