"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Spinner, Badge } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/admin/common";
import { formatDateTime } from "@/lib/dates";
import type { listOnlineOrders } from "@/server/services/public";
import { Money } from "@/components/money";
import { formatElapsed, formatTime, localDay } from "@/lib/dates";
import { useSession } from "@/hooks/use-session";
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, type Order } from "./types";

export function OrdersScreen() {
  const { timezone } = useSession();
  // Ouvert sur « Aujourd'hui » : toutes les commandes de la journée (en cours et payées) ; « En cours » n'en montre que les ouvertes
  const [tab, setTab] = useState<"open" | "today" | "online">("today");
  const qc = useQueryClient();
  const act = useAction();
  const online = useQuery({ queryKey: ["orders", "online"], queryFn: () => api.get<Awaited<ReturnType<typeof listOnlineOrders>>>("/api/online-orders"), refetchInterval: 15_000 });
  const awaiting = (online.data ?? []).filter((o) => o.awaiting).length;
  const open = useQuery({ queryKey: ["orders", "open"], queryFn: () => api.get<Order[]>("/api/orders?open=1"), refetchInterval: 20_000 });
  const today = useQuery({ queryKey: ["orders", "today"], queryFn: () => api.get<{ items: Order[]; total: number }>(`/api/orders?day=${localDay(new Date(), timezone)}&take=100`), enabled: tab === "today" });
  const list = tab === "open" ? open.data ?? [] : today.data?.items ?? [];
  const loading = tab === "open" ? open.isLoading : today.isLoading;
  void qc;
  return (
    <div className="mx-auto max-w-4xl overflow-y-auto p-4">
      <div className="mb-3 flex gap-2">
        <button onClick={() => setTab("open")} className={`touch h-11 rounded-xl px-4 text-sm font-bold ${tab === "open" ? "bg-lagon-600 text-white" : "surface-2"}`}>En cours ({open.data?.length ?? 0})</button>
        <button onClick={() => setTab("today")} className={`touch h-11 rounded-xl px-4 text-sm font-bold ${tab === "today" ? "bg-lagon-600 text-white" : "surface-2"}`}>Aujourd&apos;hui</button>
        <button onClick={() => setTab("online")} className={`touch relative h-11 rounded-xl px-4 text-sm font-bold ${tab === "online" ? "bg-lagon-600 text-white" : "surface-2"}`}>En ligne & borne{awaiting ? <span className="ml-2 rounded-full bg-corail-500 px-1.5 text-[11px] text-white pulse-soft">{awaiting}</span> : null}</button>
      </div>
      {tab === "online" ? (
        <div className="space-y-2">
          {online.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : null}
          {online.data?.length === 0 ? <p className="py-10 text-center text-sm text-muted">Aucune commande en ligne, en livraison ou depuis la borne en cours.</p> : null}
          {online.data?.map((o) => {
            const m = o.channelMeta as { channel?: string; when?: string; address?: string; zone?: string; phone?: string; mode?: string; deliveryFee?: number };
            return (
              <div key={o.id} className={`card p-3 ${o.awaiting ? "ring-2 ring-corail-500/50" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={o.type === "DELIVERY" ? "purple" : o.type === "KIOSK" ? "teal" : "blue"}>{ORDER_TYPE_LABEL[o.type]}{m.mode === "TAKEAWAY" ? " · à emporter" : m.mode === "DINE_IN" ? " · sur place" : ""}</Badge>
                  <span className="font-bold">n° {o.number.split("-")[1]} · {o.customerName ?? "—"}</span>
                  <span className="text-xs text-muted">{formatDateTime(o.openedAt, timezone)}{m.when ? ` · souhaité : ${m.when}` : ""}{m.phone ? ` · ${m.phone}` : ""}</span>
                  <span className="ml-auto text-lg font-extrabold"><Money amount={o.total + (m.deliveryFee ?? 0)} /></span>
                </div>
                {m.address ? <p className="mt-1 text-sm">📍 {m.address}{m.zone ? ` (${m.zone})` : ""}</p> : null}
                <ul className="mt-1 text-sm text-muted">{o.items.map((i) => <li key={i.id}>{i.quantity} × {i.name}{i.modifiers.length ? ` (${i.modifiers.map((x) => x.name).join(", ")})` : ""}{i.notes ? ` — « ${i.notes} »` : ""} · <span className="text-xs">{i.status === "PENDING" ? "à envoyer" : i.status === "SENT" ? "envoyé" : i.status === "PREPARING" ? "en préparation" : i.status === "READY" ? "prêt" : "servi"}</span></li>)}</ul>
                {o.notes ? <p className="mt-1 text-sm italic text-corail-500">« {o.notes} »</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {o.awaiting ? <><Button size="sm" onClick={() => act(() => api.post(`/api/online-orders/${o.id}/accept`), { success: "Commande acceptée et envoyée en cuisine", invalidate: [["orders"], ["kitchen"]] })}>Accepter → cuisine</Button><Button size="sm" variant="danger" onClick={() => { const reason = prompt("Motif du refus (communiqué au client) ?"); if (reason) act(() => api.post(`/api/online-orders/${o.id}/reject`, { reason }), { success: "Commande refusée", invalidate: [["orders"]] }); }}>Refuser</Button></> : <Badge color="green">acceptée</Badge>}
                  <Link href={`/pos/order/${o.id}?ticket=1`} className="touch inline-flex h-9 items-center rounded-xl surface-2 px-3 text-sm font-semibold">Ouvrir / encaisser</Link>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {tab !== "online" && loading ? <div className="flex justify-center py-10"><Spinner /></div> : null}
      {tab !== "online" && !loading && list.length === 0 ? <p className="py-10 text-center text-sm text-muted">Aucune commande</p> : null}
      <div className={`space-y-2 ${tab === "online" ? "hidden" : ""}`}>
        {list.map((o) => (
          <Link key={o.id} href={`/pos/order/${o.id}?ticket=1`} className="touch flex items-center gap-3 rounded-xl border border-line surface p-3 hover:surface-2">
            <div className="flex h-12 w-12 flex-col items-center justify-center rounded-lg surface-2 text-xs font-bold">{o.table ? o.table.name : ORDER_TYPE_LABEL[o.type].slice(0, 4)}</div>
            <div className="min-w-0 flex-1">
              <p className="font-bold">n° {o.number.split("-")[1]} · {o.table ? `Table ${o.table.name}` : ORDER_TYPE_LABEL[o.type]}{o.customerName ? ` · ${o.customerName}` : ""}</p>
              <p className="text-xs text-muted">{o.items.filter((i) => i.status !== "VOIDED" && !i.parentItemId).length} articles · {o.covers} cvts · {o.server?.displayName || o.server?.firstName} · {formatTime(o.openedAt, timezone)} {o.status !== "PAID" && o.status !== "CANCELLED" ? `(${formatElapsed(o.openedAt)})` : ""}</p>
            </div>
            <Badge color={o.status === "PAID" ? "green" : o.status === "CANCELLED" ? "red" : o.status === "BILL_REQUESTED" ? "purple" : o.status === "SENT" ? "blue" : "orange"}>{ORDER_STATUS_LABEL[o.status]}</Badge>
            <span className="text-lg font-bold"><Money amount={o.total} /></span>
          </Link>
        ))}
      </div>
    </div>
  );
}
