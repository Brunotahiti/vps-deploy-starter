"use client";

import { useEffect } from "react";
import { api } from "@/lib/api-client";
import { usePosCatalog } from "@/components/pos/use-catalog";
import type { Order } from "@/components/pos/types";
import { outbox } from "./outbox";
import { saveLocalOrder } from "./local-orders";

/** Demande au service worker d'enregistrer les écrans du service (caisse, salle, cuisine) pour les coupures. */
export function warmOfflinePages() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready.then((r) => r.active?.postMessage("WARM")).catch(() => {});
}

/**
 * Copie de travail pour les coupures d'internet, tenue à jour tant que le réseau est là :
 * écrans de l'application, catalogue et toutes les commandes en cours (une table ouverte sur une autre
 * tablette reste consultable et modifiable hors ligne). Rien n'est écrasé tant que des saisies hors ligne
 * attendent d'être transmises.
 */
export function useOfflineSnapshot(enabled = true) {
  usePosCatalog(enabled);
  useEffect(() => {
    if (!enabled) return;
    warmOfflinePages();
    let live = true;
    const refresh = async () => {
      if (!navigator.onLine || (await outbox.count()) > 0) return;
      try {
        const open = await api.get<Order[]>("/api/orders?open=1");
        if (live && (await outbox.count()) === 0) await Promise.all(open.map((o) => saveLocalOrder(o)));
      } catch { /* hors ligne : la dernière copie est conservée */ }
    };
    refresh();
    const t = window.setInterval(refresh, 60_000);
    return () => { live = false; window.clearInterval(t); };
  }, [enabled]);
}
