"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingBag, Store, Users, Sparkles } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { outbox } from "@/lib/offline/outbox";
import { cacheGet, cacheSet } from "@/lib/offline/db";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner, Empty } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { Money } from "@/components/money";
import { formatElapsed } from "@/lib/dates";
import { useSession } from "@/hooks/use-session";
import { TABLE_STATUS_COLOR, TABLE_STATUS_LABEL, type FloorStatus, type FloorTable, type Order } from "./types";
import { buildLocalOrder, DEFAULT_COURSE_NAMES, listOfflineCreatedOrders, saveLocalOrder } from "@/lib/offline/local-orders";
import { useOffline } from "@/lib/offline/provider";

export function useFloor() {
  return useQuery({
    queryKey: ["floor"],
    refetchInterval: 30_000,
    queryFn: async () => {
      try {
        const d = await api.get<FloorStatus>("/api/floor");
        cacheSet("floor", d).catch(() => {});
        return d;
      } catch (e) {
        const c = await cacheGet<FloorStatus>("floor");
        if (c) return c.data;
        throw e;
      }
    },
  });
}

export function FloorPlan() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can, me } = useSession();
  const { online, pending } = useOffline();
  const floor = useFloor();
  const localOrders = useQuery({ queryKey: ["offline-orders", pending], queryFn: listOfflineCreatedOrders, staleTime: 0 });
  const [roomId, setRoomId] = useState<string | null>(null);
  const [coversFor, setCoversFor] = useState<FloorTable | null>(null);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useMemo(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);

  const rooms = useMemo(() => {
    const base = floor.data?.rooms ?? [];
    const locals = localOrders.data ?? [];
    if (locals.length === 0) return base;
    // Les commandes créées hors ligne (non encore synchronisées) apparaissent sur leur table
    return base.map((r) => ({ ...r, tables: r.tables.map((t) => { const lo = t.order ? null : locals.find((o) => o.tableId === t.id); return lo ? { ...t, status: "ORDERING" as const, order: { id: lo.id, tableId: t.id, status: "OPEN" as const, covers: lo.covers, total: 0, paidTotal: 0, openedAt: new Date(lo.openedAt), serverId: null, server: null, _count: { items: 0 } } } : t; }) }));
  }, [floor.data, localOrders.data]);
  const room = rooms.find((r) => r.id === roomId) ?? rooms[0];

  const openOrder = async (input: { tableId?: string; covers?: number; type: "DINE_IN" | "COUNTER" | "TAKEAWAY" }) => {
    setBusy(true);
    const id = crypto.randomUUID();
    const courseNames = input.type === "DINE_IN" ? (((me?.establishment?.settings as { courses?: string[] } | null)?.courses) ?? DEFAULT_COURSE_NAMES) : ["COMMANDE"];
    const courses = courseNames.map((name) => ({ id: crypto.randomUUID(), name }));
    const body = { id, ...input, courses, openedAt: new Date().toISOString() };
    try {
      const order = await (online ? api.post<Order>("/api/orders", body, { idempotencyKey: id, queueIfOffline: true }) : Promise.reject(new ApiClientError(0, "QUEUED", "offline")));
      await saveLocalOrder(order);
      qc.invalidateQueries({ queryKey: ["floor"] });
      router.push(`/pos/order/${order.id}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "QUEUED") {
        // Hors ligne : la commande existe localement, elle sera créée sur le serveur à la reconnexion
        if (!online) await outbox.enqueue({ method: "POST", url: "/api/orders", body, idempotencyKey: id });
        const tableName = input.tableId ? rooms.flatMap((r) => r.tables).find((t) => t.id === input.tableId)?.name : null;
        const local = buildLocalOrder({ id, type: input.type, tableId: input.tableId ?? null, tableName, covers: input.covers ?? 1, courses, establishmentId: me?.establishment?.id ?? "", serverId: me?.user?.id ?? "", serverName: me?.user?.displayName || me?.user?.firstName || "" });
        await saveLocalOrder(local, true);
        qc.setQueryData(["order", id], local);
        qc.invalidateQueries({ queryKey: ["offline-orders"] });
        toast("Hors ligne : commande enregistrée localement, elle sera synchronisée", "info");
        router.push(`/pos/order/${id}`);
      } else toast(e instanceof ApiClientError ? e.message : "Erreur", "error");
    } finally {
      setBusy(false);
      setCoversFor(null);
    }
  };

  const onTable = async (t: FloorTable) => {
    if (t.order) return router.push(`/pos/order/${t.order.id}`);
    if (t.status === "TO_CLEAN") {
      await api.post(`/api/tables/${t.id}/state`, { state: "FREE" });
      qc.invalidateQueries({ queryKey: ["floor"] });
      return;
    }
    setCoversFor(t);
  };

  if (floor.isLoading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!room) {
    return (
      <Empty title="Aucune salle configurée" hint="Créez vos salles et tables dans Administration → Plan de salle, ou utilisez les commandes comptoir / à emporter." action={can("floor.manage") ? <Button onClick={() => router.push("/admin/floor")}>Configurer le plan de salle</Button> : null} />
    );
  }

  const scaleW = 1000 / room.width;
  const occupied = rooms.flatMap((r) => r.tables).filter((t) => t.order).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {rooms.map((r) => (
            <button key={r.id} onClick={() => setRoomId(r.id)} className={`touch h-11 shrink-0 rounded-xl px-4 text-sm font-bold ${r.id === room.id ? "bg-lagon-600 text-white" : "surface-2"}`}>
              {r.name} <span className="ml-1 opacity-70">{r.tables.filter((t) => t.order).length}/{r.tables.length}</span>
            </button>
          ))}
        </div>
        <span className="hidden text-sm text-muted md:inline"><Users className="mr-1 inline h-4 w-4" />{occupied} table{occupied > 1 ? "s" : ""} occupée{occupied > 1 ? "s" : ""}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="lg" loading={busy} onClick={() => openOrder({ type: "COUNTER" })}><Store className="h-5 w-5" /> Comptoir</Button>
          <Button variant="accent" size="lg" loading={busy} onClick={() => openOrder({ type: "TAKEAWAY" })}><ShoppingBag className="h-5 w-5" /> À emporter</Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto p-3">
        <div className="relative mx-auto rounded-2xl border border-dashed border-line surface-2" style={{ width: "min(100%, 1000px)", aspectRatio: `${room.width} / ${room.height}` }}>
          {room.tables.map((t) => {
            const color = TABLE_STATUS_COLOR[t.status];
            const w = t.width * scaleW, h = t.height * scaleW;
            return (
              <button
                key={t.id}
                onClick={() => onTable(t)}
                className="touch absolute flex flex-col items-center justify-center text-white shadow-md transition active:scale-95"
                style={{
                  left: `${(t.x / room.width) * 100}%`, top: `${(t.y / room.height) * 100}%`, width: `${(t.width / room.width) * 100}%`, height: `${(t.height / room.height) * 100}%`,
                  background: color, borderRadius: t.shape === "ROUND" ? "9999px" : "14px", transform: `rotate(${t.rotation}deg)`, minWidth: 64, minHeight: 64, fontSize: Math.max(11, Math.min(w, h) / 6),
                }}
                title={TABLE_STATUS_LABEL[t.status]}
              >
                <span className="text-lg font-extrabold leading-tight">{t.name}</span>
                {t.order ? (
                  <>
                    <span className="text-xs font-semibold opacity-90">{formatElapsed(t.order.openedAt)} · {t.order.covers} cvts</span>
                    <span className="text-xs font-bold"><Money amount={t.order.total} /></span>
                  </>
                ) : (
                  <span className="text-xs opacity-90">{t.status === "FREE" ? `${t.seats} pl.` : TABLE_STATUS_LABEL[t.status]}</span>
                )}
              </button>
            );
          })}
          {room.tables.length === 0 ? <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Aucune table dans cette salle</div> : null}
        </div>
      </div>
      <div className="no-print flex shrink-0 flex-wrap gap-3 border-t border-line px-3 py-2 text-xs">
        {(Object.keys(TABLE_STATUS_LABEL) as FloorTable["status"][]).map((s) => (
          <span key={s} className="flex items-center gap-1"><span className="h-3 w-3 rounded-full" style={{ background: TABLE_STATUS_COLOR[s] }} />{TABLE_STATUS_LABEL[s]}</span>
        ))}
      </div>

      <Modal open={!!coversFor} onClose={() => setCoversFor(null)} title={coversFor ? `Ouvrir la table ${coversFor.name}` : ""} size="sm">
        <p className="mb-3 text-sm text-muted"><Sparkles className="mr-1 inline h-4 w-4" />Nombre de couverts</p>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <button key={n} disabled={busy} onClick={() => coversFor && openOrder({ tableId: coversFor.id, covers: n, type: "DINE_IN" })} className={`touch h-16 rounded-xl text-2xl font-bold ${n === coversFor?.seats ? "bg-lagon-600 text-white" : "surface-2"}`}>{n}</button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
