"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShoppingBag, Store, Users, Sparkles, BellRing, Hand } from "lucide-react";
import { KIND_SHORT, KIND_COLOR } from "./service-todo";
import { MealSteps, StepDot } from "./meal-steps";
import { COURSE_STATE_LABEL, courseLabel } from "@/lib/meal-stage";
import { api, ApiClientError } from "@/lib/api-client";
import { outbox } from "@/lib/offline/outbox";
import { cacheGet, cacheSet } from "@/lib/offline/db";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { TableTop } from "@/components/floor/table-shape";
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
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []); // rafraîchit les durées affichées

  const rooms = useMemo(() => {
    const base = floor.data?.rooms ?? [];
    const locals = localOrders.data ?? [];
    if (locals.length === 0) return base;
    // Les commandes créées hors ligne (non encore synchronisées) apparaissent sur leur table
    return base.map((r) => ({ ...r, tables: r.tables.map((t) => { const lo = t.order ? null : locals.find((o) => o.tableId === t.id); return lo ? { ...t, status: "ORDERING" as const, order: { id: lo.id, tableId: t.id, status: "OPEN" as const, covers: lo.covers, total: 0, paidTotal: 0, openedAt: new Date(lo.openedAt), serverId: null, server: null, _count: { items: 0 }, items: undefined, readyCount: 0, meal: { steps: [], current: null } }, serverInitials: null, serverColor: null, service: null } : t; }) }));
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
    if (t.callRequestedAt) { api.delete(`/api/tables/${t.id}/call`).then(() => qc.invalidateQueries({ queryKey: ["floor"] })).catch(() => {}); toast(`Appel de la table ${t.name} pris en charge`, "success"); }
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

  const occupied = rooms.flatMap((r) => r.tables).filter((t) => t.order).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {rooms.map((r) => (
            <button key={r.id} onClick={() => setRoomId(r.id)} className={`touch h-11 shrink-0 rounded-full px-5 text-sm font-bold transition ${r.id === room.id ? "bg-brand text-white shadow-glow" : "card text-muted hover:text-[var(--text)]"}`}>
              {r.name} <span className={`ml-1.5 rounded-full px-2 py-0.5 text-xs ${r.id === room.id ? "bg-white/20" : "surface-2"}`}>{r.tables.filter((t) => t.order).length}/{r.tables.length}</span>
            </button>
          ))}
        </div>
        <span className="hidden text-sm text-muted md:inline"><Users className="mr-1 inline h-4 w-4" />{occupied} table{occupied > 1 ? "s" : ""} occupée{occupied > 1 ? "s" : ""}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="md" className="sm:h-14 sm:px-6 sm:text-base sm:rounded-2xl" loading={busy} onClick={() => openOrder({ type: "COUNTER" })}><Store className="h-5 w-5" /> Comptoir</Button>
          <Button variant="accent" size="md" className="sm:h-14 sm:px-6 sm:text-base sm:rounded-2xl" loading={busy} onClick={() => openOrder({ type: "TAKEAWAY" })}><ShoppingBag className="h-5 w-5" /> À emporter</Button>
        </div>
      </div>
      {/* Téléphone : liste des tables en cartes (le plan spatial est illisible sous 600 px) */}
      <div className="sm:hidden min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="grid grid-cols-2 gap-2.5">
          {room.tables.map((t) => {
            const color = TABLE_STATUS_COLOR[t.status];
            return (
              <button key={t.id} onClick={() => onTable(t)} className="touch card flex min-h-[96px] flex-col justify-between overflow-hidden p-3 text-left transition active:scale-[0.98]" title={TABLE_STATUS_LABEL[t.status]}>
                <span className="flex items-center justify-between"><span className="text-lg font-extrabold"><span data-testid="table-name">{t.name}</span>{t.order && t.serverInitials ? <span className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full align-middle text-[9px] font-extrabold text-white" style={{ background: t.serverColor ?? "#334155" }} title="Serveur">{t.serverInitials}</span> : null}{t.callRequestedAt ? <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-corail-500 px-2 py-0.5 align-middle text-[11px] font-extrabold text-white pulse-soft"><Hand className="h-3 w-3" />appel</span> : null}</span>{t.order?.readyCount ? <span className="flex items-center gap-1 rounded-full bg-green-500 px-2 py-0.5 text-[11px] font-extrabold text-white pulse-soft"><BellRing className="h-3 w-3" />{t.order.readyCount} prêt{t.order.readyCount > 1 ? "s" : ""}</span> : <span className="h-3 w-3 rounded-full shadow-sm" style={{ background: color }} />}</span>
                {t.order ? (
                  <span className="mt-1"><span className="block text-base font-extrabold" style={{ color }}><Money amount={t.order.total} /></span><span className="block text-[11px] text-muted">{formatElapsed(t.order.openedAt)} · {t.order.covers} cvts · {TABLE_STATUS_LABEL[t.status]}</span><MealSteps meal={t.order.meal} className="mt-1.5" />{t.service ? <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white ${t.service.late ? "bg-red-600 pulse-soft" : ""}`} style={t.service.late ? undefined : { background: KIND_COLOR[t.service.kind] }}>{KIND_SHORT[t.service.kind]}{t.service.count > 1 ? ` +${t.service.count - 1}` : ""}{t.service.waitingMin ? ` · ${t.service.waitingMin} min` : ""}</span> : null}</span>
                ) : (
                  <span className="mt-1 text-xs font-medium text-muted">{t.status === "FREE" ? `${t.seats} places · libre` : TABLE_STATUS_LABEL[t.status]}</span>
                )}
              </button>
            );
          })}
          {room.tables.length === 0 ? <p className="col-span-full py-10 text-center text-sm text-muted">Aucune table dans cette salle</p> : null}
        </div>
      </div>
      <div className="relative hidden min-h-0 flex-1 overflow-auto px-3 pb-3 sm:block sm:px-4">
        <div className="card relative mx-auto overflow-hidden" style={{ width: "min(100%, 1000px)", aspectRatio: `${room.width} / ${room.height}`, background: "var(--surface)", backgroundImage: "linear-gradient(color-mix(in srgb, var(--border) 70%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--border) 70%, transparent) 1px, transparent 1px)", backgroundSize: "40px 40px" }}>
          {room.tables.map((t) => {
            const color = TABLE_STATUS_COLOR[t.status];
            return (
              <button
                key={t.id}
                onClick={() => onTable(t)}
                className="touch absolute transition hover:brightness-105 active:scale-95"
                style={{ left: `${(t.x / room.width) * 100}%`, top: `${(t.y / room.height) * 100}%`, width: `${(t.width / room.width) * 100}%`, height: `${(t.height / room.height) * 100}%`, transform: `rotate(${t.rotation}deg)`, minWidth: 84, minHeight: 84 }}
                title={TABLE_STATUS_LABEL[t.status]}
              >
                <TableTop shape={t.shape} seats={t.seats} width={t.width} height={t.height} color={`linear-gradient(145deg, color-mix(in srgb, ${color} 80%, white), ${color} 55%, color-mix(in srgb, ${color} 82%, black))`} chairColor={`color-mix(in srgb, ${color} 55%, var(--surface-2))`} className="h-full w-full text-white" style={{ outline: t.service?.late ? "3px solid rgb(220 38 38 / 0.7)" : t.status === "BILL" ? "3px solid rgb(168 85 247 / 0.35)" : undefined, outlineOffset: 2, borderRadius: t.shape === "ROUND" ? "9999px" : "18px" }}>
                  <span data-testid="table-name" className="text-base font-extrabold leading-none drop-shadow-sm">{t.name}</span>
                  {t.order ? (
                    <>
                      <span className="mt-1 text-xs font-extrabold leading-none"><Money amount={t.order.total} /></span>
                      {t.order.meal.current
                        ? <span className="mt-1 max-w-full truncate px-1 text-[10px] font-extrabold leading-none" title={`${formatElapsed(t.order.openedAt)} · ${t.order.covers} couverts`}>{courseLabel(t.order.meal.current.name)} · {COURSE_STATE_LABEL[t.order.meal.current.state]}</span>
                        : <span className="mt-1 text-[10px] font-semibold leading-none opacity-90">{formatElapsed(t.order.openedAt)} · {t.order.covers} cvts</span>}
                    </>
                  ) : (
                    <span className="mt-1 text-[11px] font-medium leading-none opacity-90">{t.status === "FREE" ? `${t.seats} places` : TABLE_STATUS_LABEL[t.status]}</span>
                  )}
                </TableTop>
                {t.callRequestedAt ? <span className="absolute -left-1.5 -top-1.5 flex items-center gap-0.5 rounded-full bg-corail-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white shadow-lift pulse-soft" title="Appel serveur"><Hand className="h-3 w-3" />appel</span> : null}
                {t.order ? (
                  <>
                    {t.order.meal.steps.length ? <MealSteps meal={t.order.meal} compact className="absolute -top-3 left-1/2 -translate-x-1/2" /> : null}
                    {t.order.readyCount ? <span className="absolute -right-1.5 -top-1.5 flex items-center gap-0.5 rounded-full bg-green-500 px-1.5 py-0.5 text-[10px] font-extrabold text-white shadow-lift pulse-soft" title="Plats prêts en cuisine"><BellRing className="h-3 w-3" />{t.order.readyCount}</span> : null}
                    {t.serverInitials && !t.callRequestedAt ? <span className="absolute -left-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-extrabold text-white shadow-lift ring-2 ring-[var(--surface)]" style={{ background: t.serverColor ?? "#334155" }} title="Serveur responsable">{t.serverInitials}</span> : null}
                    {t.service ? <span className={`absolute -bottom-2.5 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-extrabold shadow-lift ${t.service.late ? "bg-red-600 text-white pulse-soft" : "text-white"}`} style={t.service.late ? undefined : { background: KIND_COLOR[t.service.kind] }} title={t.service.label}>{KIND_SHORT[t.service.kind]}{t.service.count > 1 ? ` +${t.service.count - 1}` : ""}{t.service.waitingMin ? ` · ${t.service.waitingMin} min` : ""}</span> : null}
                  </>
                ) : null}
              </button>
            );
          })}
          {room.tables.length === 0 ? <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Aucune table dans cette salle</div> : null}
        </div>
      </div>
      <div className="no-print hidden shrink-0 flex-wrap gap-2 px-3 pb-3 text-xs sm:flex sm:px-4">
        {(Object.keys(TABLE_STATUS_LABEL) as FloorTable["status"][]).map((s) => (
          <span key={s} className="flex items-center gap-1.5 rounded-full surface-2 px-2.5 py-1 font-medium text-muted"><span className="h-2.5 w-2.5 rounded-full" style={{ background: TABLE_STATUS_COLOR[s] }} />{TABLE_STATUS_LABEL[s]}</span>
        ))}
        <span className="flex items-center gap-2 rounded-full surface-2 px-2.5 py-1 font-medium text-muted" title="Au-dessus de chaque table : une pastille par suite commandée">
          Repas :
          <span className="flex items-center gap-1"><StepDot name="Entrées" state="SERVED" />servi</span>
          <span className="flex items-center gap-1"><StepDot name="Plats" state="COOKING" />en cuisine</span>
          <span className="flex items-center gap-1"><StepDot name="Plats" state="READY" />prêt</span>
          <span className="flex items-center gap-1"><StepDot name="Desserts" state="PENDING" />à envoyer</span>
        </span>
      </div>

      <Modal open={!!coversFor} onClose={() => setCoversFor(null)} title={coversFor ? `Ouvrir la table ${coversFor.name}` : ""} size="sm">
        <p className="mb-3 text-sm text-muted"><Sparkles className="mr-1 inline h-4 w-4" />Nombre de couverts</p>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
            <button key={n} disabled={busy} onClick={() => coversFor && openOrder({ tableId: coversFor.id, covers: n, type: "DINE_IN" })} className={`touch h-16 rounded-2xl text-2xl font-bold transition active:scale-95 ${n === coversFor?.seats ? "bg-brand text-white shadow-glow" : "surface-2 hover:surface-3"}`}>{n}</button>
          ))}
        </div>
      </Modal>
    </div>
  );
}
