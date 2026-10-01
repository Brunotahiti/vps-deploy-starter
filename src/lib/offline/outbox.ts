import { cacheGet, cacheSet, withDb, type OutboxEntry } from "./db";
import { aliasesForCreatedOrder, rewriteEntry, type Aliases } from "./merge";

const ALIASES = "order-aliases";
export type MergeNotice = { number: string; tableName: string | null };

type Listener = (state: { pending: number; syncing: boolean; lastError: string | null }) => void;

/**
 * File d'attente des opérations effectuées hors ligne.
 * Chaque entrée porte une clé d'idempotence : le serveur ne l'appliquera qu'une fois.
 */
class Outbox {
  private listeners = new Set<Listener>();
  private syncing = false;
  private lastError: string | null = null;
  private merges: MergeNotice[] = [];

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    this.notify();
    return () => { this.listeners.delete(fn); };
  }

  private async notify() {
    const pending = await this.count().catch(() => 0); // base locale momentanément indisponible : l'affichage ne doit pas planter
    for (const fn of this.listeners) fn({ pending, syncing: this.syncing, lastError: this.lastError });
  }

  lastErrorMessage() {
    return this.lastError;
  }

  /** Tables ouvertes hors ligne alors qu'un autre appareil les avait déjà ouvertes (lu une seule fois). */
  takeMergeNotices() {
    const m = this.merges;
    this.merges = [];
    return m;
  }

  async count() {
    return withDb((db) => db.count("outbox"), 0);
  }

  async enqueue(entry: Omit<OutboxEntry, "id" | "createdAt" | "attempts">) {
    const saved = await withDb(async (db) => { await db.put("outbox", { ...entry, id: crypto.randomUUID(), createdAt: Date.now(), attempts: 0 }); return true; }, false);
    if (!saved) throw new Error("IndexedDB indisponible");
    await this.notify();
  }

  /**
   * Rejoue les opérations dans l'ordre. Règles :
   * - succès → retirée de la file ;
   * - 401/403 (session expirée, droits) → GARDÉE, synchronisation suspendue jusqu'à la reconnexion ;
   * - autre refus définitif (4xx) → retirée mais conservée dans le journal « outbox-failed » (jamais perdue en silence) ;
   * - erreur réseau / 5xx → gardée, nouvel essai plus tard ;
   * - table ouverte entre-temps sur un autre appareil → la suite de la file vise la commande existante (voir merge.ts).
   * Un seul onglet synchronise à la fois (verrou navigateur), pour ne jamais rejouer deux fois la même file.
   */
  async flush(): Promise<{ sent: number; failed: number; authRequired?: boolean }> {
    const run = () => this.flushNow();
    const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (!locks) return run();
    const r = await locks.request("mr-outbox", { ifAvailable: true }, async (lock) => (lock ? run() : null));
    return r ?? { sent: 0, failed: 0 };
  }

  private async flushNow(): Promise<{ sent: number; failed: number; authRequired?: boolean }> {
    if (typeof indexedDB === "undefined" || this.syncing) return { sent: 0, failed: 0 };
    // Chaque accès rouvre la connexion si le navigateur l'a fermée entre deux envois (iPhone en arrière-plan)
    const put = (e: OutboxEntry) => withDb((db) => db.put("outbox", e), undefined);
    const del = (id: string) => withDb((db) => db.delete("outbox", id), undefined);
    this.syncing = true;
    this.lastError = null;
    await this.notify();
    let sent = 0, failed = 0, authRequired = false;
    try {
      const entries = await withDb((db) => db.getAllFromIndex("outbox", "byCreated"), [] as OutboxEntry[]);
      // Redirections conservées entre deux synchronisations (la file peut s'interrompre au milieu)
      const aliases: Aliases = (await cacheGet<Aliases>(ALIASES))?.data ?? {};
      for (const queued of entries) {
        const e = rewriteEntry(queued, aliases);
        try {
          const res = await fetch(e.url, {
            method: e.method, credentials: "same-origin",
            headers: { "Content-Type": "application/json", Accept: "application/json", "Idempotency-Key": e.idempotencyKey, "X-Offline-Replay": "1" },
            body: e.body === undefined ? undefined : JSON.stringify(e.body),
          });
          if (res.ok) {
            sent++;
            if (e.method === "POST" && e.url === "/api/orders") {
              const created = (await res.json().catch(() => null))?.data as { id: string; number: string; table?: { name: string } | null; courses?: { id: string; name: string; sortOrder?: number }[] } | undefined;
              const more = aliasesForCreatedOrder(e.body as { id?: string; courses?: { id: string; name: string }[] }, created);
              if (more && created) {
                Object.assign(aliases, more);
                await cacheSet(ALIASES, aliases);
                this.merges.push({ number: created.number, tableName: created.table?.name ?? null });
              }
            }
            await del(e.id);
            continue;
          }
          if (res.status === 401 || res.status === 403) {
            authRequired = true;
            this.lastError = "Session expirée : reconnectez-vous pour transmettre les opérations en attente";
            await put({ ...e, attempts: e.attempts + 1, lastError: `HTTP ${res.status}` });
            break;
          }
          if (res.status === 409 && res.headers.get("Idempotency-In-Progress")) { await put({ ...e, attempts: e.attempts + 1 }); break; } // même opération encore en cours : on réessaiera
          if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
            failed++;
            const j = await res.json().catch(() => null);
            this.lastError = j?.error?.message ?? `HTTP ${res.status}`;
            const log = (await cacheGet<FailedEntry[]>("outbox-failed"))?.data ?? [];
            await cacheSet("outbox-failed", [...log, { ...e, lastError: this.lastError ?? undefined, failedAt: Date.now() }].slice(-200));
            await del(e.id);
            continue;
          }
          await put({ ...e, attempts: e.attempts + 1, lastError: `HTTP ${res.status}` });
          break; // serveur momentanément indisponible : on réessaiera
        } catch (err) {
          await put({ ...e, attempts: e.attempts + 1, lastError: String(err) });
          break; // toujours hors ligne
        }
      }
    } finally {
      this.syncing = false;
      await this.notify();
    }
    return { sent, failed, authRequired };
  }
}

export type FailedEntry = OutboxEntry & { failedAt: number };

/** Journal des opérations refusées par le serveur (diagnostic, jamais effacé en silence). */
export async function listFailedOperations() {
  return (await cacheGet<FailedEntry[]>("outbox-failed"))?.data ?? [];
}

/** Commande existante qui a recueilli une commande créée hors ligne sur la même table (sinon null). */
export async function mergedOrderId(orderId: string) {
  return (await cacheGet<Aliases>(ALIASES))?.data?.[orderId] ?? null;
}

export const outbox = new Outbox();
