"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ToastProvider } from "@/components/ui/toast";
import { OfflineProvider } from "@/lib/offline/provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 5_000, retry: (count, err) => !(err instanceof Object && "status" in err && (err as { status: number }).status < 500) && count < 2, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <OfflineProvider>{children}</OfflineProvider>
        <UpdateBanner />
      </ToastProvider>
    </QueryClientProvider>
  );
}

/**
 * Mise à jour de l'application (PWA) : enregistre le service worker, vérifie régulièrement s'il existe une
 * nouvelle version (à chaque retour au premier plan et toutes les 30 min) et affiche un bouton « Mettre à jour ».
 * La nouvelle version ne s'active qu'au clic : elle prend alors le contrôle et la page se recharge.
 */
function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    let reg: ServiceWorkerRegistration | undefined;
    let reloading = false;
    // Au tout premier chargement, le service worker prend le contrôle (clients.claim) : ne pas recharger dans ce cas
    const hadController = !!navigator.serviceWorker.controller;
    const onWaiting = (sw: ServiceWorker | null) => { if (sw && navigator.serviceWorker.controller) setWaiting(sw); };
    navigator.serviceWorker.register("/sw.js").then((r) => {
      reg = r;
      onWaiting(r.waiting);
      r.addEventListener("updatefound", () => {
        const sw = r.installing;
        sw?.addEventListener("statechange", () => { if (sw.state === "installed") onWaiting(sw); });
      });
    }).catch(() => {});
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloading) { reloading = true; window.location.reload(); } });
    const check = () => { if (document.visibilityState === "visible") reg?.update().catch(() => {}); };
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, 30 * 60_000);
    return () => { document.removeEventListener("visibilitychange", check); clearInterval(timer); };
  }, []);
  if (!waiting) return null;
  return (
    <div className="no-print fixed inset-x-0 bottom-0 z-[70] flex justify-center p-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }} role="status">
      <div className="glass flex w-full max-w-md items-center gap-3 rounded-2xl border px-4 py-3 shadow-lift">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-white"><RefreshCw className={`h-4 w-4 ${updating ? "animate-spin" : ""}`} /></span>
        <span className="min-w-0 flex-1 text-sm"><b>Nouvelle version disponible</b><span className="block text-xs text-muted">Mettez à jour pour profiter des dernières améliorations.</span></span>
        <button onClick={() => { setUpdating(true); waiting.postMessage("SKIP_WAITING"); }} disabled={updating} className="touch h-10 shrink-0 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-glow disabled:opacity-60">Mettre à jour</button>
      </div>
    </div>
  );
}
