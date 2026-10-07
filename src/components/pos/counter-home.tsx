"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Store, RefreshCw, BellRing, Check } from "lucide-react";
import type { TakeawayCard } from "@/server/services/takeaway";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError } from "@/lib/api-client";
import { outbox } from "@/lib/offline/outbox";
import { offlineAllowed } from "@/lib/offline/auth-state";
import { useOffline } from "@/lib/offline/provider";
import { useSession } from "@/hooks/use-session";
import { buildLocalOrder, saveLocalOrder } from "@/lib/offline/local-orders";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import type { Order } from "./types";
import { OrderScreen } from "./order-screen";

/**
 * Mode roulotte : la page d'accueil de la caisse est directement la prise de commande au comptoir.
 * Le client choisit à l'écran, on encaisse, la commande part en cuisine ; « Commande suivante » en ouvre une autre.
 * Rechargement de la page : on retrouve la commande en cours (brouillon de cette personne sur cet appareil).
 */
export function CounterHome() {
  const qc = useQueryClient();
  const { me } = useSession();
  const { online } = useOffline();
  const [attempt, setAttempt] = useState(0);
  const draft = useQuery({
    queryKey: ["counter-draft", attempt],
    retry: false, staleTime: Infinity, gcTime: 0, refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: async (): Promise<string> => {
      try {
        const o = await api.post<Order>("/api/orders/counter-draft", undefined, { idempotencyKey: crypto.randomUUID() });
        await saveLocalOrder(o).catch(() => {});
        qc.setQueryData(["order", o.id], o);
        return o.id;
      } catch (e) {
        const network = e instanceof ApiClientError && (e.isNetwork || e.code === "OFFLINE" || e.code === "QUEUED");
        if (!(network && offlineAllowed() && me?.user)) throw e;
        // Sans internet (option Continuité) : la commande existe sur la tablette et sera créée au serveur à la reconnexion
        const id = crypto.randomUUID();
        const courses = [{ id: crypto.randomUUID(), name: "COMMANDE" }];
        await outbox.enqueue({ method: "POST", url: "/api/orders", body: { id, type: "COUNTER", courses, openedAt: new Date().toISOString() }, idempotencyKey: id });
        const local = buildLocalOrder({ id, type: "COUNTER", tableId: null, covers: 1, courses, establishmentId: me.establishment?.id ?? "", serverId: me.user.id, serverName: me.user.displayName || me.user.firstName });
        await saveLocalOrder(local, true);
        qc.setQueryData(["order", id], local);
        qc.invalidateQueries({ queryKey: ["offline-orders"] });
        return id;
      }
    },
  });
  const next = () => setAttempt((n) => n + 1);

  if (draft.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-lagon-500/15 text-brand"><Store className="h-7 w-7" /></span>
        <p className="text-base font-bold">Comptoir indisponible</p>
        <p className="max-w-sm text-sm text-muted">{draft.error instanceof ApiClientError ? draft.error.message : "Impossible d'ouvrir une commande"}{!online ? " · connexion internet perdue" : ""}</p>
        <Button variant="secondary" onClick={next}><RefreshCw className="h-4 w-4" /> Réessayer</Button>
      </div>
    );
  }
  if (!draft.data) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  return (
    <div className="flex h-full flex-col">
      <ReadyBanner />
      <div className="min-h-0 flex-1"><OrderScreen key={draft.data} orderId={draft.data} counter onNext={next} /></div>
    </div>
  );
}

/**
 * Plats prêts en cuisine (commandes de ce comptoir) : le serveur va les chercher, les apporte au client, puis
 * appuie sur « Remis » ; la commande quitte la file. Rafraîchi en temps réel (kitchen.updated / order.updated).
 */
export function ReadyBanner({ className = "" }: { className?: string } = {}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const board = useQuery({ queryKey: ["takeaway"], queryFn: () => api.get<{ toAccept: TakeawayCard[]; preparing: TakeawayCard[]; ready: TakeawayCard[] }>("/api/takeaway"), refetchInterval: 20_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const ready = (board.data?.ready ?? []).filter((c) => c.channel !== "DELIVERY");
  if (ready.length === 0) return null;
  const handed = async (c: TakeawayCard) => {
    setBusy(c.id);
    try { await api.post(`/api/orders/${c.id}/takeaway`, { step: "picked_up" }); toast(`N° ${c.call} remise au client ✓`, "success"); qc.invalidateQueries({ queryKey: ["takeaway"] }); qc.invalidateQueries({ queryKey: ["orders"] }); }
    catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); }
    finally { setBusy(null); }
  };
  return (
    <section className={`no-print shrink-0 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 p-3 text-white shadow-lift ${className || "mx-2 mt-2"}`} data-testid="counter-ready">
      <p className="mb-2 flex items-center gap-2 text-sm font-extrabold"><BellRing className="h-4 w-4 animate-bounce" />Prêt en cuisine : à aller chercher et apporter au client</p>
      <div className="flex gap-2 overflow-x-auto no-scrollbar">
        {ready.map((c) => (
          <div key={c.id} className="flex shrink-0 items-center gap-2 rounded-xl bg-white/20 py-1.5 pl-3 pr-1.5 backdrop-blur">
            <span className="leading-tight"><span className="block text-lg font-extrabold">N° {c.call}</span><span className="block text-[11px] opacity-90">{c.channel === "COUNTER" ? "Sur place" : "À emporter"}{c.name ? ` · ${c.name}` : ""} · {c.items} article{c.items > 1 ? "s" : ""}</span></span>
            <button onClick={() => handed(c)} disabled={busy === c.id} className="touch flex h-10 items-center gap-1 rounded-lg bg-white px-3 text-xs font-extrabold text-emerald-700 active:scale-95 disabled:opacity-60" data-testid="counter-handed"><Check className="h-4 w-4" />Remis</button>
          </div>
        ))}
      </div>
    </section>
  );
}
