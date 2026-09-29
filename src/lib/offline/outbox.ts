import { getDb, type OutboxEntry } from "./db";

type Listener = (state: { pending: number; syncing: boolean; lastError: string | null }) => void;

/**
 * File d'attente des opérations effectuées hors ligne.
 * Chaque entrée porte une clé d'idempotence : le serveur ne l'appliquera qu'une fois.
 */
class Outbox {
  private listeners = new Set<Listener>();
  private syncing = false;
  private lastError: string | null = null;

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    this.notify();
    return () => { this.listeners.delete(fn); };
  }

  private async notify() {
    const pending = await this.count();
    for (const fn of this.listeners) fn({ pending, syncing: this.syncing, lastError: this.lastError });
  }

  async count() {
    const db = await getDb();
    return db ? db.count("outbox") : 0;
  }

  async enqueue(entry: Omit<OutboxEntry, "id" | "createdAt" | "attempts">) {
    const db = await getDb();
    if (!db) throw new Error("IndexedDB indisponible");
    await db.put("outbox", { ...entry, id: crypto.randomUUID(), createdAt: Date.now(), attempts: 0 });
    await this.notify();
  }

  /** Rejoue les opérations dans l'ordre. S'arrête à la première erreur réseau. */
  async flush(): Promise<{ sent: number; failed: number }> {
    const db = await getDb();
    if (!db || this.syncing) return { sent: 0, failed: 0 };
    this.syncing = true;
    this.lastError = null;
    await this.notify();
    let sent = 0, failed = 0;
    try {
      const entries = await db.getAllFromIndex("outbox", "byCreated");
      for (const e of entries) {
        try {
          const res = await fetch(e.url, {
            method: e.method, credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": e.idempotencyKey },
            body: e.body === undefined ? undefined : JSON.stringify(e.body),
          });
          if (res.ok || (res.status >= 400 && res.status < 500)) {
            // Succès, ou erreur métier définitive (conflit, validation) : on retire de la file et on trace
            if (!res.ok) { failed++; const j = await res.json().catch(() => null); this.lastError = j?.error?.message ?? `HTTP ${res.status}`; }
            else sent++;
            await db.delete("outbox", e.id);
          } else {
            await db.put("outbox", { ...e, attempts: e.attempts + 1, lastError: `HTTP ${res.status}` });
            break;
          }
        } catch (err) {
          await db.put("outbox", { ...e, attempts: e.attempts + 1, lastError: String(err) });
          break; // toujours hors ligne
        }
      }
    } finally {
      this.syncing = false;
      await this.notify();
    }
    return { sent, failed };
  }
}

export const outbox = new Outbox();
