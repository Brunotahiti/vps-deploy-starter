"use client";

import { useEffect } from "react";

/** Temps d'utilisation : un battement par minute tant que l'application est ouverte, visible et en ligne. */
export function useHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const beat = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      fetch("/api/auth/heartbeat", { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => {});
    };
    beat();
    const id = window.setInterval(beat, 60_000);
    return () => window.clearInterval(id);
  }, [enabled]);
}
