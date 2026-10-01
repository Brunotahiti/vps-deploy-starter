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

/**
 * Connexion à la base locale. Sur iPhone (Safari, navigateur intégré de Facebook ou d'Instagram), le système peut
 * fermer la connexion quand la page passe en arrière-plan : on l'oublie alors pour en rouvrir une au prochain accès.
 */
export function getDb() {
  if (typeof indexedDB === "undefined") return null;
  if (!dbPromise) {
    const forget = () => { if (dbPromise === p) dbPromise = null; };
    const p: Promise<IDBPDatabase<ManaDB>> = openDB<ManaDB>("manaresto", 1, {
      upgrade(db) {
        db.createObjectStore("cache", { keyPath: "key" });
        const ob = db.createObjectStore("outbox", { keyPath: "id" });
        ob.createIndex("byCreated", "createdAt");
      },
      terminated: forget, // fermée par le navigateur
    });
    p.then((db) => db.addEventListener("versionchange", () => { db.close(); forget(); }), forget);
    dbPromise = p;
  }
  return dbPromise;
}

/** Connexion en cours de fermeture (InvalidStateError) ou fermée pendant l'opération. */
function isClosedConnection(e: unknown) {
  const name = (e as { name?: string } | null)?.name;
  return name === "InvalidStateError" || name === "TransactionInactiveError" || (name === "AbortError" && /clos/i.test(String((e as Error).message)));
}

/**
 * Exécute une opération sur la base locale ; si la connexion vient d'être fermée par le navigateur,
 * en rouvre une et réessaie une fois. Retourne `fallback` si IndexedDB est indisponible.
 */
export async function withDb<T>(fn: (db: IDBPDatabase<ManaDB>) => Promise<T>, fallback: T): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const db = await getDb();
    if (!db) return fallback;
    try {
      return await fn(db);
    } catch (e) {
      if (attempt > 0 || !isClosedConnection(e)) throw e;
      if (dbPromise) { const stale = dbPromise; dbPromise = null; stale.then((d) => d.close()).catch(() => {}); }
    }
  }
}

export async function cacheSet(key: string, data: unknown) {
  await withDb((db) => db.put("cache", { key, data, savedAt: Date.now() }), undefined);
}

export async function cacheGet<T>(key: string): Promise<{ data: T; savedAt: number } | null> {
  const row = await withDb((db) => db.get("cache", key), undefined);
  return row ? { data: row.data as T, savedAt: row.savedAt } : null;
}
