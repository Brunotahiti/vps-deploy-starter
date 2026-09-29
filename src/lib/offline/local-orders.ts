/**
 * Commandes locales (mode hors ligne).
 * Une commande créée ou modifiée sans réseau est conservée dans IndexedDB
 * jusqu'à ce que la file d'attente (outbox) l'ait rejouée sur le serveur.
 */
import { cacheGet, cacheSet, getDb } from "./db";
import type { Order } from "@/components/pos/types";

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

/** Appelé après une synchronisation réussie : le serveur redevient la source de vérité. */
export async function clearOfflineCreatedOrders() {
  await cacheSet(INDEX, []);
  const db = await getDb();
  if (!db) return;
  const keys = await db.getAllKeys("cache");
  for (const k of keys) if (String(k).startsWith("order:")) await db.delete("cache", k);
}

/** Squelette de commande construit localement, identique à la réponse serveur attendue. */
export function buildLocalOrder(input: { id: string; type: Order["type"]; tableId: string | null; tableName?: string | null; covers: number; courses: { id: string; name: string }[]; establishmentId: string; serverId: string; serverName: string }): Order {
  const now = new Date();
  return {
    id: input.id, establishmentId: input.establishmentId, number: "HORS-LIGNE", type: input.type, status: "OPEN", tableId: input.tableId, serverId: input.serverId, terminalId: null,
    customerId: null, customerName: null, covers: input.covers, subtotal: 0, discountTotal: 0, discountReason: null, taxTotal: 0, total: 0, tipTotal: 0, paidTotal: 0, notes: null,
    cancelReason: null, version: 0, openedAt: now, billRequestedAt: null, closedAt: null, createdAt: now, updatedAt: now,
    table: input.tableId ? { id: input.tableId, name: input.tableName ?? "", roomId: "", seats: input.covers } : null,
    server: { id: input.serverId, firstName: input.serverName, lastName: "", displayName: input.serverName },
    courses: input.courses.map((c, i) => ({ id: c.id, orderId: input.id, name: c.name, sortOrder: i, status: "PENDING", sentAt: null, firedAt: null, createdAt: now })),
    items: [], payments: [],
  };
}

export const DEFAULT_COURSE_NAMES = ["APÉRITIFS", "ENTRÉES", "PLATS", "DESSERTS"];
