"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { outbox } from "./outbox";

type OfflineState = { online: boolean; pending: number; syncing: boolean; lastError: string | null; flush: () => Promise<void> };
const Ctx = createContext<OfflineState>({ online: true, pending: 0, syncing: false, lastError: null, flush: async () => {} });

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [state, setState] = useState({ pending: 0, syncing: false, lastError: null as string | null });

  useEffect(() => {
    const on = async () => { const r = await outbox.flush(); if (r.sent > 0) qc.invalidateQueries(); };
    window.addEventListener("online", on);
    const unsub = outbox.subscribe(setState);
    // Tentative de synchro au chargement
    if (navigator.onLine) outbox.flush().then((r) => { if (r.sent > 0) qc.invalidateQueries(); });
    return () => { window.removeEventListener("online", on); unsub(); };
  }, [qc]);

  const flush = async () => { const r = await outbox.flush(); if (r.sent > 0) qc.invalidateQueries(); };
  return <Ctx.Provider value={{ online, ...state, flush }}>{children}</Ctx.Provider>;
}

export const useOffline = () => useContext(Ctx);
