import { EventEmitter } from "node:events";

/**
 * Bus d'événements temps réel.
 * - Mémoire (mono-instance) par défaut.
 * - Redis pub/sub (Phase 7) quand REDIS_URL est défini : chaque instance publie sur un canal et
 *   redistribue localement ce qu'elle reçoit, ce qui permet plusieurs instances derrière Traefik.
 * Les webhooks (Phase 7) sont déclenchés à la publication, une seule fois, par l'instance émettrice.
 */
export type RealtimeEventType =
  | "order.updated" | "order.created" | "order.closed" | "table.updated" | "product.availability"
  | "cash.updated" | "kitchen.updated" | "catalog.updated" | "floor.updated" | "service.updated";
export const REALTIME_EVENT_TYPES: RealtimeEventType[] = ["order.updated", "order.created", "order.closed", "table.updated", "product.availability", "cash.updated", "kitchen.updated", "catalog.updated", "floor.updated", "service.updated"];

export type RealtimeEvent = { type: RealtimeEventType; establishmentId: string; payload: Record<string, unknown>; at: string };

export interface RealtimeBus {
  readonly kind: "memory" | "redis";
  publish(event: Omit<RealtimeEvent, "at">): void;
  subscribe(establishmentId: string, handler: (event: RealtimeEvent) => void): () => void;
}

class MemoryBus implements RealtimeBus {
  readonly kind: "memory" | "redis" = "memory";
  protected emitter = new EventEmitter();
  constructor() { this.emitter.setMaxListeners(0); }
  protected emitLocal(full: RealtimeEvent) { this.emitter.emit(`est:${full.establishmentId}`, full); }
  publish(event: Omit<RealtimeEvent, "at">) { this.emitLocal({ ...event, at: new Date().toISOString() }); }
  subscribe(establishmentId: string, handler: (event: RealtimeEvent) => void) {
    const key = `est:${establishmentId}`;
    this.emitter.on(key, handler);
    return () => this.emitter.off(key, handler);
  }
}

const CHANNEL = "manaresto:realtime";

/** Redis : publication sur un canal partagé ; les événements reçus (y compris les siens) sont redistribués localement. */
class RedisBus extends MemoryBus implements RealtimeBus {
  override readonly kind: "memory" | "redis" = "redis";
  private pub: import("ioredis").default | null = null;
  private sub: import("ioredis").default | null = null;
  private ready = false;
  constructor(private url: string) {
    super();
    void this.connect();
  }
  private async connect() {
    const Redis = (await import("ioredis")).default;
    this.pub = new Redis(this.url, { lazyConnect: false, maxRetriesPerRequest: 2, enableOfflineQueue: true });
    this.sub = new Redis(this.url, { lazyConnect: false, maxRetriesPerRequest: 2 });
    this.pub.on("error", (e) => console.warn("[realtime] redis (pub)", e.message));
    this.sub.on("error", (e) => console.warn("[realtime] redis (sub)", e.message));
    this.sub.on("message", (_ch: string, msg: string) => { try { this.emitLocal(JSON.parse(msg) as RealtimeEvent); } catch { /* message invalide */ } });
    await this.sub.subscribe(CHANNEL);
    this.ready = true;
    console.log("[realtime] bus Redis actif");
  }
  override publish(event: Omit<RealtimeEvent, "at">) {
    const full: RealtimeEvent = { ...event, at: new Date().toISOString() };
    if (this.ready && this.pub) this.pub.publish(CHANNEL, JSON.stringify(full)).catch(() => this.emitLocal(full));
    else this.emitLocal(full);
  }
}

const globalForBus = globalThis as unknown as { realtimeBus?: RealtimeBus };
export const realtime: RealtimeBus = globalForBus.realtimeBus ?? (process.env.REDIS_URL ? new RedisBus(process.env.REDIS_URL) : new MemoryBus());
globalForBus.realtimeBus = realtime;

type WebhookHook = (type: RealtimeEventType, establishmentId: string, payload: Record<string, unknown>) => void;
const globalForHooks = globalThis as unknown as { realtimeWebhookHook?: WebhookHook };
/** Enregistré par src/server/webhooks.ts (évite une dépendance circulaire avec Prisma). */
export function setWebhookHook(hook: WebhookHook) { globalForHooks.realtimeWebhookHook = hook; }

export function publish(type: RealtimeEventType, establishmentId: string, payload: Record<string, unknown> = {}) {
  realtime.publish({ type, establishmentId, payload });
  try { globalForHooks.realtimeWebhookHook?.(type, establishmentId, payload); } catch { /* jamais bloquant */ }
}
