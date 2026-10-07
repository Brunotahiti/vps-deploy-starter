"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Users } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useFloor } from "@/components/pos/floor";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { useToast } from "@/components/ui/toast";
import { formatElapsed } from "@/lib/dates";
import type { FloorTable, Order } from "@/components/pos/types";
import { PushBanner, PushToggle } from "@/components/push-toggle";
import { ReadyBanner } from "@/components/pos/counter-home";
import { useQuery } from "@tanstack/react-query";
import { Plus, ShoppingBag } from "lucide-react";

const LOOK: Record<FloorTable["status"], { label: string; emoji: string; ring: string; bg: string }> = {
  FREE: { label: "Libre", emoji: "🟢", ring: "ring-emerald-400/50", bg: "from-emerald-50 to-white dark:from-emerald-500/10 dark:to-transparent" },
  OCCUPIED: { label: "Installée", emoji: "🟡", ring: "ring-amber-400/60", bg: "from-amber-50 to-white dark:from-amber-500/10 dark:to-transparent" },
  ORDERING: { label: "Commande en cours", emoji: "📝", ring: "ring-orange-400/60", bg: "from-orange-50 to-white dark:from-orange-500/10 dark:to-transparent" },
  SENT: { label: "En cuisine", emoji: "👨‍🍳", ring: "ring-sky-400/60", bg: "from-sky-50 to-white dark:from-sky-500/10 dark:to-transparent" },
  BILL: { label: "Addition", emoji: "🧾", ring: "ring-purple-400/60", bg: "from-purple-50 to-white dark:from-purple-500/10 dark:to-transparent" },
  RESERVED: { label: "Réservée", emoji: "📅", ring: "ring-slate-400/60", bg: "from-slate-100 to-white dark:from-slate-500/10 dark:to-transparent" },
  TO_CLEAN: { label: "À débarrasser", emoji: "🧽", ring: "ring-red-400/60", bg: "from-red-50 to-white dark:from-red-500/10 dark:to-transparent" },
};

/**
 * Portail « Commande » : les tables en grosses tuiles, les plats prêts en tête d'écran.
 * Une table libre s'ouvre en choisissant le nombre de couverts, une table occupée ouvre sa commande.
 */
export function WaiterTables() {
  const router = useRouter();
  const { toast } = useToast();
  const { me, payAtOrder } = useSession();
  const floor = useFloor();
  // Mode roulotte : commandes au comptoir prises depuis le téléphone (encaissées puis envoyées en cuisine)
  const mine = useQuery({ queryKey: ["orders", "open"], queryFn: () => api.get<Order[]>("/api/orders?open=1"), enabled: payAtOrder, refetchInterval: 20_000 });
  const myDrafts = (mine.data ?? []).filter((o) => (o.type === "COUNTER" || o.type === "TAKEAWAY") && o.serverId === me?.user?.id && o.paidTotal === 0 && !o.isTab);
  const newCounterOrder = async () => {
    setBusy(true);
    try { const id = crypto.randomUUID(); const order = await api.post<Order>("/api/orders", { id, type: "COUNTER" }, { idempotencyKey: id }); router.push(`/pos/m/${order.id}`); }
    catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); setBusy(false); }
  };
  const [roomId, setRoomId] = useState<string | null>(null);
  const [opening, setOpening] = useState<FloorTable | null>(null);
  const [busy, setBusy] = useState(false);
  const rooms = floor.data?.rooms ?? [];
  const room = rooms.find((r) => r.id === roomId) ?? rooms[0];
  const all = rooms.flatMap((r) => r.tables.map((t) => ({ ...t, room: r.name })));
  const ready = all.filter((t) => t.order?.readyCount);
  const myTables = all.filter((t) => t.order && t.order.serverId === me?.user?.id).length;
  const first = (me?.user?.displayName || me?.user?.firstName || "").split(" ")[0];

  const open = async (t: FloorTable, covers: number) => {
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const order = await api.post<Order>("/api/orders", { id, type: "DINE_IN", tableId: t.id, covers }, { idempotencyKey: id });
      router.push(`/pos/m/${order.id}`);
    } catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); }
    finally { setBusy(false); setOpening(null); }
  };
  const tap = (t: FloorTable) => (t.order ? router.push(`/pos/m/${t.order.id}`) : setOpening(t));

  if (floor.isLoading && !payAtOrder) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-6 pt-4" data-testid="waiter-tables">
      <div className="mb-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-extrabold">Bonjour {first} 👋</p>
          <p className="text-sm text-muted">{payAtOrder ? (myDrafts.length ? `${myDrafts.length} commande${myDrafts.length > 1 ? "s" : ""} en cours` : "Prenez la commande, encaissez, c'est parti en cuisine") : myTables ? `${myTables} table${myTables > 1 ? "s" : ""} à vous` : "Touchez une table pour prendre la commande"}</p>
        </div>
        <PushToggle compact />
      </div>
      <PushBanner className="mb-4" />
      {payAtOrder ? (
        <>
          <ReadyBanner className="mb-4" />
          <button onClick={newCounterOrder} disabled={busy} data-testid="waiter-new-order" className="touch mb-4 flex h-20 w-full items-center justify-center gap-3 rounded-3xl bg-gradient-to-r from-lagon-500 to-lagon-700 text-xl font-extrabold text-white shadow-lift active:scale-[0.98] disabled:opacity-60"><Plus className="h-7 w-7" />Nouvelle commande</button>
          {myDrafts.length ? (
            <section className="mb-4">
              <p className="mb-2 flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-muted"><ShoppingBag className="h-4 w-4" />À encaisser</p>
              <div className="space-y-2">
                {myDrafts.map((o) => <button key={o.id} onClick={() => router.push(`/pos/m/${o.id}`)} className="touch card flex w-full items-center gap-3 p-3 text-left active:scale-[0.98]"><span className="min-w-0 flex-1"><span className="block truncate font-extrabold">{o.type === "TAKEAWAY" ? "À emporter" : "Sur place"}{o.customerName ? ` · ${o.customerName}` : ""} <span className="font-normal text-muted">· n° {o.number.split("-").pop()}</span></span><span className="block text-xs text-muted">{o.items.filter((i) => i.status !== "VOIDED" && !i.parentItemId).reduce((a, i) => a + i.quantity, 0)} article(s) · {formatElapsed(o.openedAt)}</span></span><Money amount={o.total} className="font-extrabold" /></button>)}
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {ready.length ? (
        <section className="mb-4 rounded-3xl bg-gradient-to-br from-emerald-500 to-green-600 p-4 text-white shadow-lift" data-testid="ready-banner">
          <p className="mb-2 flex items-center gap-2 text-lg font-extrabold"><BellRing className="h-5 w-5 animate-bounce" />Prêt à servir !</p>
          <div className="flex flex-wrap gap-2">{ready.map((t) => <button key={t.id} onClick={() => tap(t)} className="touch rounded-2xl bg-white/20 px-4 py-2 text-base font-extrabold backdrop-blur active:scale-95">Table {t.name} · {t.order!.readyCount} plat{t.order!.readyCount > 1 ? "s" : ""}</button>)}</div>
        </section>
      ) : null}

      {rooms.length > 1 ? (
        <div className="mb-3 flex gap-2 overflow-x-auto no-scrollbar">
          {rooms.map((r) => <button key={r.id} onClick={() => setRoomId(r.id)} className={`touch h-11 shrink-0 rounded-full px-5 text-sm font-bold ${r.id === room?.id ? "bg-brand text-white shadow-glow" : "card text-muted"}`}>{r.name}</button>)}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 min-[420px]:grid-cols-3">
        {(room?.tables ?? []).map((t) => {
          const look = LOOK[t.status];
          return (
            <button key={t.id} onClick={() => tap(t)} data-testid="waiter-table" className={`touch relative flex aspect-square flex-col items-center justify-center rounded-3xl bg-gradient-to-br ${look.bg} p-2 text-center ring-2 ${look.ring} shadow-soft transition active:scale-95`}>
              <span className="text-2xl" aria-hidden>{look.emoji}</span>
              <span className="text-2xl font-extrabold leading-tight">{t.name}</span>
              {t.order ? <>
                <span className="text-sm font-bold"><Money amount={t.order.total} /></span>
                <span className="text-[11px] font-semibold text-muted">{t.order.covers} pers. · {formatElapsed(t.order.openedAt)}</span>
              </> : <span className="text-xs font-semibold text-muted">{look.label} · {t.seats} pl.</span>}
              {t.order?.readyCount ? <span className="absolute -right-1 -top-1 flex items-center gap-1 rounded-full bg-green-500 px-2 py-0.5 text-xs font-extrabold text-white shadow-lift pulse-soft">🍽️ {t.order.readyCount}</span> : null}
            </button>
          );
        })}
      </div>
      {!room?.tables.length && !payAtOrder ? <p className="py-10 text-center text-sm text-muted">Aucune table : le plan de salle se dessine dans Gestion → Plan de salle.</p> : null}

      <Modal open={!!opening} onClose={() => setOpening(null)} title={opening ? `Table ${opening.name}` : ""} size="sm">
        <p className="mb-3 flex items-center gap-2 text-base font-bold"><Users className="h-5 w-5 text-lagon-600" />Combien de personnes ?</p>
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <button key={n} disabled={busy} onClick={() => opening && open(opening, n)} className="touch h-16 rounded-2xl surface-2 text-2xl font-extrabold active:scale-95 active:bg-brand active:text-white disabled:opacity-50">{n}</button>)}
        </div>
      </Modal>
    </div>
  );
}
