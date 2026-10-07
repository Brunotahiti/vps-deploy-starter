"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Store, RefreshCw } from "lucide-react";
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
  return <OrderScreen key={draft.data} orderId={draft.data} counter onNext={next} />;
}
