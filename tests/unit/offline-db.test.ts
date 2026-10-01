import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sur iPhone (Safari, navigateur intégré de Facebook), le système ferme la connexion à la base locale quand la page
 * passe en arrière-plan : la connexion gardée lève alors InvalidStateError (« The database connection is closing »).
 */
const opened: { closed: boolean; put: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> }[] = [];
const closing = () => Object.assign(new Error("Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing."), { name: "InvalidStateError" });

vi.mock("idb", () => ({
  openDB: vi.fn(async () => {
    const db = {
      closed: false,
      put: vi.fn(async () => { if (db.closed) throw closing(); }),
      get: vi.fn(async () => { if (db.closed) throw closing(); return { key: "k", data: 42, savedAt: 1 }; }),
      count: vi.fn(async () => { if (db.closed) throw closing(); return 3; }),
      close: vi.fn(),
      addEventListener: vi.fn(),
    };
    opened.push(db);
    return db;
  }),
}));

beforeEach(() => {
  opened.length = 0;
  vi.resetModules();
  (globalThis as { indexedDB?: unknown }).indexedDB = {};
});

describe("base locale fermée par le navigateur", () => {
  it("rouvre la connexion et réessaie l'opération, sans erreur pour l'appelant", async () => {
    const { cacheGet, cacheSet } = await import("@/lib/offline/db");
    await cacheSet("k", 1);
    expect(opened).toHaveLength(1);
    opened[0].closed = true; // la page est passée en arrière-plan
    await cacheSet("k", 2);
    expect(opened).toHaveLength(2);
    expect(opened[1].put).toHaveBeenCalledTimes(1);
    expect((await cacheGet<number>("k"))?.data).toBe(42);
    expect(opened).toHaveLength(2); // la nouvelle connexion est réutilisée
  });

  it("la file d'attente compte ses opérations même après la fermeture", async () => {
    const { getDb } = await import("@/lib/offline/db");
    const { outbox } = await import("@/lib/offline/outbox");
    await getDb();
    opened[0].closed = true;
    expect(await outbox.count()).toBe(3);
  });

  it("une autre erreur n'est pas masquée", async () => {
    const { withDb } = await import("@/lib/offline/db");
    await expect(withDb(async () => { throw Object.assign(new Error("quota"), { name: "QuotaExceededError" }); }, null)).rejects.toThrow("quota");
  });

  it("sans IndexedDB (navigation privée ancienne), rien ne plante", async () => {
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    const { cacheGet, cacheSet } = await import("@/lib/offline/db");
    await cacheSet("k", 1);
    expect(await cacheGet("k")).toBeNull();
  });
});
