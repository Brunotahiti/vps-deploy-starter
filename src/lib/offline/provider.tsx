"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { outbox } from "./outbox";
import { clearOfflineCreatedOrders } from "./local-orders";
import { useToast } from "@/components/ui/toast";

type OfflineState = { online: boolean; pending: number; syncing: boolean; lastError: string | null; flush: () => Promise<void> };
const Ctx = createContext<OfflineState>({ online: true, pending: 0, syncing: false, lastError: null, flush: async () => {} });

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [state, setState] = useState({ pending: 0, syncing: false, lastError: null as string | null });

  useEffect(() => {
    const after = async (r: { sent: number; failed: number }) => {
      if (r.sent > 0 || r.failed > 0) {
        if ((await outbox.count()) === 0) await clearOfflineCreatedOrders().catch(() => {});
        qc.invalidateQueries();
        if (r.sent > 0) toast(`Synchronisation : ${r.sent} opération${r.sent > 1 ? "s" : ""} transmise${r.sent > 1 ? "s" : ""}`, "success");
        if (r.failed > 0) toast(`${r.failed} opération${r.failed > 1 ? "s" : ""} refusée${r.failed > 1 ? "s" : ""} par le serveur (voir l'historique)`, "error");
      }
    };
    const on = async () => after(await outbox.flush());
    window.addEventListener("online", on);
    const unsub = outbox.subscribe(setState);
    // Tentative de synchro au chargement
    if (navigator.onLine) outbox.flush().then(after);
    return () => { window.removeEventListener("online", on); unsub(); };
  }, [qc, toast]);

  const flush = async () => { const r = await outbox.flush(); if ((await outbox.count()) === 0) await clearOfflineCreatedOrders().catch(() => {}); if (r.sent > 0) qc.invalidateQueries(); };
  return <Ctx.Provider value={{ online, ...state, flush }}>{children}</Ctx.Provider>;
}

export const useOffline = () => useContext(Ctx);
