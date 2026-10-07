"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";

type PushInfo = { enabled: boolean; publicKey: string | null; subscriptions: { id: string; endpoint: string }[] };
export type PushState = "unsupported" | "disabled" | "denied" | "off" | "on" | "loading";

/** Clé VAPID (base64url) → tableau d'octets attendu par le navigateur. */
function keyBytes(b64url: string) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** État de cet appareil : service worker enregistré, permission, abonnement push existant. */
async function readLocal() {
  if (!supported()) return { permission: "default" as NotificationPermission, endpoint: null as string | null, ready: false };
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  return { permission: Notification.permission, endpoint: sub?.endpoint ?? null, ready: !!reg };
}

/**
 * Notifications push « plat prêt » sur cet appareil : état (pris en charge, refusé, activé…), activation et désactivation.
 * Le service worker n'existant qu'en production (build), l'état est « non pris en charge » en développement.
 */
export function usePush(enabled = true) {
  const qc = useQueryClient();
  const on = enabled && supported();
  const info = useQuery({ queryKey: ["push"], queryFn: () => api.get<PushInfo>("/api/push"), enabled: on, staleTime: 60_000 });
  const local = useQuery({ queryKey: ["push", "device"], queryFn: readLocal, enabled: on, staleTime: Infinity });
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["push"] });

  const state: PushState = !supported() || (local.data && !local.data.ready) ? "unsupported"
    : info.isLoading || local.isLoading ? "loading"
    : !info.data?.enabled ? "disabled"
    : local.data?.permission === "denied" ? "denied"
    : local.data?.endpoint && info.data.subscriptions.some((s) => s.endpoint === local.data!.endpoint) ? "on"
    : "off";

  /** Demande la permission, abonne l'appareil et l'enregistre sur le serveur. Retourne true si tout a abouti. */
  const subscribe = async () => {
    const publicKey = info.data?.publicKey;
    if (!supported() || !publicKey) return false;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return false;
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return false;
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      await api.post("/api/push", sub.toJSON());
      return true;
    } catch { return false; }
    finally { setBusy(false); await refresh(); }
  };

  const unsubscribe = async () => {
    if (!supported()) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) { await api.delete("/api/push", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
    } finally { setBusy(false); await refresh(); }
  };

  return { state, busy, subscribe, unsubscribe };
}
