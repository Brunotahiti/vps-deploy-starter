"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

type Ev = { type: string; establishmentId: string; payload: Record<string, unknown>; at: string };

/** Abonnement SSE : invalide les requêtes concernées à chaque événement. */
export function useRealtime(enabled = true, onEvent?: (ev: Ev) => void) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);
  const handler = useRef(onEvent);
  useEffect(() => { handler.current = onEvent; });

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      es = new EventSource("/api/realtime");
      es.onopen = () => setConnected(true);
      es.onmessage = (m) => {
        if (!m.data) return;
        let ev: Ev;
        try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.type === "hello") return;
        const keys: string[][] = [];
        if (ev.type.startsWith("order.")) { keys.push(["orders"], ["floor"], ["service"], ["takeaway"]); if (ev.payload.orderId) keys.push(["order", ev.payload.orderId as string]); keys.push(["reports"]); }
        if (ev.type === "table.updated" || ev.type === "floor.updated") keys.push(["floor"], ["rooms"]);
        if (ev.type === "product.availability" || ev.type === "catalog.updated") keys.push(["pos-catalog"], ["products"], ["categories"], ["menus"], ["modifier-groups"]);
        if (ev.type === "cash.updated") keys.push(["cash"]);
        if (ev.type === "kitchen.updated") keys.push(["kitchen"], ["takeaway"]);
        if (ev.type === "service.updated") { keys.push(["service"], ["floor"]); if (ev.payload.orderId) keys.push(["order", ev.payload.orderId as string]); }
        for (const k of keys) qc.invalidateQueries({ queryKey: k });
        handler.current?.(ev);
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => { closed = true; es?.close(); if (retry) clearTimeout(retry); };
  }, [enabled, qc]);
  return connected;
}
