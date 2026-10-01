import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type OutboxEntry = {
  id: string; method: string; url: string; body?: unknown; idempotencyKey: string; createdAt: number; attempts: number; lastError?: string;
  /** Laissez-passer de qui a saisi l'opération (et du manager qui l'a autorisée), rejoués avec elle */
  headers?: Record<string, string>;
};

interface ManaDB extends DBSchema {
  cache: { key: string; value: { key: string; data: unknown; savedAt: number } };
  outbox: { key: string; value: OutboxEntry; indexes: { byCreated: number } };
}

let dbPromise: Promise<IDBPDatabase<ManaDB>> | null = null;

export function getDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    dbPromise = openDB<ManaDB>("manaresto", 1, {
      upgrade(db) {
        db.createObjectStore("cache", { keyPath: "key" });
        const ob = db.createObjectStore("outbox", { keyPath: "id" });
        ob.createIndex("byCreated", "createdAt");
      },
    });
  }
  return dbPromise;
}

export async function cacheSet(key: string, data: unknown) {
  const db = await getDb();
  if (!db) return;
  await db.put("cache", { key, data, savedAt: Date.now() });
}

export async function cacheGet<T>(key: string): Promise<{ data: T; savedAt: number } | null> {
  const db = await getDb();
  if (!db) return null;
  const row = await db.get("cache", key);
  return row ? { data: row.data as T, savedAt: row.savedAt } : null;
}
