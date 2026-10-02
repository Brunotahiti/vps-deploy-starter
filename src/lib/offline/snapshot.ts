"use client";

import { useEffect } from "react";
import { api } from "@/lib/api-client";
import { usePosCatalog } from "@/components/pos/use-catalog";
import type { Order } from "@/components/pos/types";
import { outbox } from "./outbox";
import { saveLocalOrder } from "./local-orders";
import { syncOfflinePasses } from "./passes";

/**
 * Demande au service worker d'enregistrer les écrans du service (caisse, salle, cuisine) pour les coupures.
 * Quelques secondes après l'ouverture : l'écran affiché garde la priorité sur le réseau.
 */
export function warmOfflinePages(delayMs = 4000) {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => {};
  const t = window.setTimeout(() => navigator.serviceWorker.ready.then((r) => r.active?.postMessage("WARM")).catch(() => {}), delayMs);
  return () => window.clearTimeout(t);
}

/**
 * Copie de travail pour les coupures d'internet, tenue à jour tant que le réseau est là :
 * écrans de l'application, laissez-passer des employés (connexion par PIN), catalogue et toutes les commandes en cours (une table ouverte sur une autre
 * tablette reste consultable et modifiable hors ligne). Rien n'est écrasé tant que des saisies hors ligne
 * attendent d'être transmises.
 */
/** Copie de travail pour les coupures (option Continuité de service ; `offline` faux : seule la carte est chargée). */
export function useOfflineSnapshot(enabled = true, offline = true) {
  usePosCatalog(enabled);
  useEffect(() => {
    if (!enabled || !offline) return;
    const cancelWarm = warmOfflinePages();
    let live = true;
    const refresh = async () => {
      if (!navigator.onLine) return;
      syncOfflinePasses().catch(() => {}); // connexion par PIN possible pendant une coupure (toutes les 10 min au plus)
      if ((await outbox.count()) > 0) return;
      try {
        const open = await api.get<Order[]>("/api/orders?open=1");
        if (live && (await outbox.count()) === 0) await Promise.all(open.map((o) => saveLocalOrder(o)));
      } catch { /* hors ligne : la dernière copie est conservée */ }
    };
    const first = window.setTimeout(refresh, 3000); // après le premier affichage
    const t = window.setInterval(refresh, 60_000);
    return () => { live = false; cancelWarm(); window.clearTimeout(first); window.clearInterval(t); };
  }, [enabled, offline]);
}
