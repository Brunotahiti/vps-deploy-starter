"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * Préchargement : dès qu'un écran est ouvert, les pages voisines (code et squelette) et leurs données sont
 * chargées en arrière-plan, quand le navigateur n'a rien d'autre à faire. Le passage d'un écran à l'autre
 * est alors immédiat, même sur une connexion lente (le serveur est loin de Tahiti : chaque aller-retour compte).
 * Rien n'est lancé hors ligne, ni tant que la page n'est pas visible.
 */
type Warm = { key: QueryKey; fn: () => Promise<unknown>; staleTime?: number };

const idle = (cb: () => void, delay: number) => {
  if (typeof window === "undefined") return () => {};
  let idleId: number | null = null;
  const t = window.setTimeout(() => {
    if ("requestIdleCallback" in window) idleId = window.requestIdleCallback(cb, { timeout: 4000 });
    else cb();
  }, delay);
  return () => { window.clearTimeout(t); if (idleId !== null && "cancelIdleCallback" in window) window.cancelIdleCallback(idleId); };
};

export function usePrefetch({ routes = [], warm = [], enabled = true, delay = 1200 }: { routes?: string[]; warm?: Warm[]; enabled?: boolean; delay?: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  // Listes sérialisées : l'effet ne repart que si leur contenu change
  const routesKey = routes.join("|");
  const warmKey = warm.map((w) => JSON.stringify(w.key)).join("|");
  useEffect(() => {
    if (!enabled || typeof navigator !== "undefined" && navigator.onLine === false) return;
    return idle(() => {
      if (document.visibilityState !== "visible") return;
      // Pages : code et écran de chargement, par petites salves pour ne pas gêner l'écran en cours
      routesKey.split("|").filter(Boolean).forEach((href, i) => window.setTimeout(() => { try { router.prefetch(href); } catch { /* route inconnue */ } }, i * 150));
      // Données : seulement celles qui ne sont pas déjà fraîches dans le cache
      for (const w of warm) qc.prefetchQuery({ queryKey: w.key, queryFn: w.fn, staleTime: w.staleTime ?? 30_000 }).catch(() => {});
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, routesKey, warmKey, delay, router, qc]);
}
