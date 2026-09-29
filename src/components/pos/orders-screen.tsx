"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Spinner, Badge } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { formatElapsed, formatTime, localDay } from "@/lib/dates";
import { useSession } from "@/hooks/use-session";
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, type Order } from "./types";

export function OrdersScreen() {
  const { timezone } = useSession();
  const [tab, setTab] = useState<"open" | "today">("open");
  const open = useQuery({ queryKey: ["orders", "open"], queryFn: () => api.get<Order[]>("/api/orders?open=1"), refetchInterval: 20_000 });
  const today = useQuery({ queryKey: ["orders", "today"], queryFn: () => api.get<{ items: Order[]; total: number }>(`/api/orders?day=${localDay(new Date(), timezone)}&take=100`), enabled: tab === "today" });
  const list = tab === "open" ? open.data ?? [] : today.data?.items ?? [];
  const loading = tab === "open" ? open.isLoading : today.isLoading;
  return (
    <div className="mx-auto max-w-4xl overflow-y-auto p-4">
      <div className="mb-3 flex gap-2">
        <button onClick={() => setTab("open")} className={`touch h-11 rounded-xl px-4 text-sm font-bold ${tab === "open" ? "bg-lagon-600 text-white" : "surface-2"}`}>En cours ({open.data?.length ?? 0})</button>
        <button onClick={() => setTab("today")} className={`touch h-11 rounded-xl px-4 text-sm font-bold ${tab === "today" ? "bg-lagon-600 text-white" : "surface-2"}`}>Aujourd&apos;hui</button>
      </div>
      {loading ? <div className="flex justify-center py-10"><Spinner /></div> : null}
      {!loading && list.length === 0 ? <p className="py-10 text-center text-sm text-muted">Aucune commande</p> : null}
      <div className="space-y-2">
        {list.map((o) => (
          <Link key={o.id} href={`/pos/order/${o.id}`} className="touch flex items-center gap-3 rounded-xl border border-line surface p-3 hover:surface-2">
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
