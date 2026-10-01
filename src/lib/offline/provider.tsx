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
    const after = async (r: { sent: number; failed: number; authRequired?: boolean }) => {
      if (r.authRequired) toast("Session expirée : reconnectez-vous pour transmettre les opérations en attente (elles sont conservées)", "error");
      if (r.sent > 0 || r.failed > 0) {
        // Copies locales des commandes créées hors ligne : effacées seulement si TOUT a été accepté
        if (r.failed === 0 && (await outbox.count()) === 0) await clearOfflineCreatedOrders().catch(() => {});
        qc.invalidateQueries();
        for (const m of outbox.takeMergeNotices()) toast(`${m.tableName ? `Table ${m.tableName}` : "Table"} déjà ouverte sur un autre appareil : les articles saisis hors ligne ont été ajoutés à sa commande n° ${m.number.split("-").pop()}`, "info");
        if (r.sent > 0) toast(`Synchronisation : ${r.sent} opération${r.sent > 1 ? "s" : ""} transmise${r.sent > 1 ? "s" : ""}`, "success");
        if (r.failed > 0) toast(`${r.failed} opération${r.failed > 1 ? "s" : ""} refusée${r.failed > 1 ? "s" : ""} par le serveur : ${outbox.lastErrorMessage() ?? "vérifiez la commande concernée"}`, "error");
      }
    };
    // Synchronisation en arrière-plan : une erreur (base locale fermée par le navigateur…) attend le prochain essai
    const sync = () => outbox.flush().then(after).catch(() => {});
    const on = () => { sync(); };
    window.addEventListener("online", on);
    const unsub = outbox.subscribe(setState);
    // Tentative de synchro au chargement, au retour au premier plan, puis toutes les 20 s tant que la file n'est pas vide
    // (box sans internet : le Wi-Fi reste « en ligne » et l'événement online n'arrive jamais)
    if (navigator.onLine) sync();
    const tick = window.setInterval(() => { if (navigator.onLine) outbox.count().then((n) => { if (n > 0) sync(); }).catch(() => {}); }, 20_000);
    const onVisible = () => { if (document.visibilityState === "visible" && navigator.onLine) sync(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.removeEventListener("online", on); document.removeEventListener("visibilitychange", onVisible); window.clearInterval(tick); unsub(); };
  }, [qc, toast]);

  const flush = async () => { const r = await outbox.flush(); if (r.failed === 0 && (await outbox.count()) === 0) await clearOfflineCreatedOrders().catch(() => {}); if (r.sent > 0) qc.invalidateQueries(); };
  return <Ctx.Provider value={{ online, ...state, flush }}>{children}</Ctx.Provider>;
}

export const useOffline = () => useContext(Ctx);
