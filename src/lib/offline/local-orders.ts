/**
 * Commandes locales (mode hors ligne).
 * Une commande créée ou modifiée sans réseau est conservée dans IndexedDB
 * jusqu'à ce que la file d'attente (outbox) l'ait rejouée sur le serveur.
 */
import { cacheGet, cacheSet, withDb } from "./db";
import type { FloorStatus, FloorTable, Order } from "@/components/pos/types";

const KEY = (id: string) => `order:${id}`;
const INDEX = "offline-orders";

export type LocalOrderMeta = { id: string; tableId: string | null; covers: number; type: string; openedAt: string; number: string };

export async function saveLocalOrder(order: Order, offlineCreated = false) {
  await cacheSet(KEY(order.id), order);
  if (offlineCreated) {
    const list = (await cacheGet<LocalOrderMeta[]>(INDEX))?.data ?? [];
    if (!list.some((o) => o.id === order.id)) {
      await cacheSet(INDEX, [...list, { id: order.id, tableId: order.tableId, covers: order.covers, type: order.type, openedAt: String(order.openedAt), number: order.number }]);
    }
  }
}

export async function getLocalOrder(id: string): Promise<Order | null> {
  return (await cacheGet<Order>(KEY(id)))?.data ?? null;
}

export async function listOfflineCreatedOrders(): Promise<LocalOrderMeta[]> {
  return (await cacheGet<LocalOrderMeta[]>(INDEX))?.data ?? [];
}

export async function markOfflineOrderClosed(id: string) {
  const list = (await cacheGet<LocalOrderMeta[]>(INDEX))?.data ?? [];
  await cacheSet(INDEX, list.filter((o) => o.id !== id));
}

/**
 * Plan de salle pendant une coupure : tables encaissées ou libérées sur cet appareil, pas encore transmises.
 * Appliqué par-dessus le plan (copie locale OU réponse du serveur tant que la file n'est pas vidée).
 */
export type FloorOverrides = { closedOrders: string[]; freedTables: string[] };
const OVERRIDES = "offline-floor";

export async function getFloorOverrides(): Promise<FloorOverrides> {
  return (await cacheGet<FloorOverrides>(OVERRIDES))?.data ?? { closedOrders: [], freedTables: [] };
}

export async function addFloorOverride(kind: keyof FloorOverrides, id: string) {
  const cur = await getFloorOverrides();
  if (!cur[kind].includes(id)) await cacheSet(OVERRIDES, { ...cur, [kind]: [...cur[kind], id].slice(-200) });
}

/** File vidée : le serveur connaît tout, le plan redevient le sien. */
export async function clearFloorOverrides() {
  await cacheSet(OVERRIDES, { closedOrders: [], freedTables: [] });
}

export function applyFloorOverrides(floor: FloorStatus, ov: FloorOverrides, markToClean: boolean): FloorStatus {
  if (ov.closedOrders.length === 0 && ov.freedTables.length === 0) return floor;
  const free = (t: FloorTable, status: FloorTable["status"]): FloorTable => ({ ...t, status, order: null, serverInitials: null, serverColor: null, service: null });
  return {
    ...floor,
    rooms: floor.rooms.map((r) => ({
      ...r,
      tables: r.tables.map((t) => {
        if (t.order && ov.closedOrders.includes(t.order.id)) return free(t, markToClean && !ov.freedTables.includes(t.id) ? "TO_CLEAN" : "FREE");
        if (!t.order && t.status === "TO_CLEAN" && ov.freedTables.includes(t.id)) return free(t, "FREE");
        return t;
      }),
    })),
  };
}

/** Appelé après une synchronisation réussie : le serveur redevient la source de vérité. */
export async function clearOfflineCreatedOrders() {
  await cacheSet(INDEX, []);
  await withDb(async (db) => {
    const keys = await db.getAllKeys("cache");
    for (const k of keys) if (String(k).startsWith("order:")) await db.delete("cache", k);
  }, undefined);
}

/** Squelette de commande construit localement, identique à la réponse serveur attendue. */
export function buildLocalOrder(input: { id: string; type: Order["type"]; tableId: string | null; tableName?: string | null; covers: number; courses: { id: string; name: string }[]; establishmentId: string; serverId: string; serverName: string }): Order {
  const now = new Date();
  return {
    id: input.id, establishmentId: input.establishmentId, number: "HORS-LIGNE", type: input.type, status: "OPEN", tableId: input.tableId, serverId: input.serverId, terminalId: null,
    customerId: null, publicToken: null, channelMeta: null, acceptedAt: null, customerName: null, customerPhone: null, pickupAt: null, readyAt: null, pickedUpAt: null, covers: input.covers, subtotal: 0, discountTotal: 0, discountReason: null, taxTotal: 0, total: 0, tipTotal: 0, paidTotal: 0, notes: null,
    cancelReason: null, version: 0, openedAt: now, billRequestedAt: null, closedAt: null, isTab: false, createdAt: now, updatedAt: now,
    table: input.tableId ? { id: input.tableId, name: input.tableName ?? "", roomId: "", seats: input.covers } : null,
    server: { id: input.serverId, firstName: input.serverName, lastName: "", displayName: input.serverName },
    courses: input.courses.map((c, i) => ({ id: c.id, orderId: input.id, name: c.name, sortOrder: i, status: "PENDING", sentAt: null, firedAt: null, createdAt: now })),
    items: [], payments: [],
  };
}

export const DEFAULT_COURSE_NAMES = ["APÉRITIFS", "ENTRÉES", "PLATS", "DESSERTS"];
