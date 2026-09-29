import { EventEmitter } from "node:events";

/**
 * Bus d'événements temps réel.
 * Implémentation en mémoire (mono-instance). Interface conçue pour être
 * remplacée par Redis pub/sub lorsque plusieurs instances seront déployées.
 */
export type RealtimeEvent = {
  type:
    | "order.updated"
    | "order.created"
    | "order.closed"
    | "table.updated"
    | "product.availability"
    | "cash.updated"
    | "kitchen.updated"
    | "catalog.updated"
    | "floor.updated";
  establishmentId: string;
  payload: Record<string, unknown>;
  at: string;
};

export interface RealtimeBus {
  publish(event: Omit<RealtimeEvent, "at">): void;
  subscribe(establishmentId: string, handler: (event: RealtimeEvent) => void): () => void;
}

class MemoryBus implements RealtimeBus {
  private emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  publish(event: Omit<RealtimeEvent, "at">) {
    const full: RealtimeEvent = { ...event, at: new Date().toISOString() };
    this.emitter.emit(`est:${event.establishmentId}`, full);
  }
  subscribe(establishmentId: string, handler: (event: RealtimeEvent) => void) {
    const key = `est:${establishmentId}`;
    this.emitter.on(key, handler);
    return () => this.emitter.off(key, handler);
  }
}

const globalForBus = globalThis as unknown as { realtimeBus?: RealtimeBus };
export const realtime: RealtimeBus = globalForBus.realtimeBus ?? new MemoryBus();
globalForBus.realtimeBus = realtime;

export function publish(type: RealtimeEvent["type"], establishmentId: string, payload: Record<string, unknown> = {}) {
  realtime.publish({ type, establishmentId, payload });
}
