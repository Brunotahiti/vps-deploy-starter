"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChefHat, Flame, Printer, Volume2, VolumeX, Maximize2, Minimize2, Moon, Sun, LogOut, LayoutGrid, Check, RotateCcw, Wifi, WifiOff, History } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useRealtime } from "@/hooks/use-realtime";
import { useTheme } from "@/hooks/use-theme";
import { useToast } from "@/components/ui/toast";
import { Spinner } from "@/components/ui/misc";
import { Logo } from "@/components/brand";
import { ORDER_TYPE_LABEL } from "@/components/pos/types";
import { TICKET_STATUS_LABEL, type KitchenSummary, type KitchenTicket } from "./types";

type View = "active" | "ready" | "done";
const ALL = "__all__";

function mmss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Bip court (WebAudio) à l'arrivée d'un nouveau ticket. */
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const play = (at: number, freq: number) => { const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = "sine"; o.frequency.value = freq; g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.4, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25); o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + 0.3); };
    play(ctx.currentTime, 880); play(ctx.currentTime + 0.18, 1175);
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch { /* audio indisponible */ }
}

export function KdsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { me, can, isLoading } = useSession();
  const { toggle } = useTheme();
  const [stationId, setStationId] = useState<string>(() => { try { return localStorage.getItem("mr-kds-station") || ALL; } catch { return ALL; } });
  const [view, setView] = useState<View>("active");
  const [sound, setSound] = useState<boolean>(() => { try { return localStorage.getItem("mr-kds-sound") !== "off"; } catch { return true; } });
  const [full, setFull] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const newCount = useRef<number | null>(null);
  const enabled = !!me?.user && can("kds.use");

  const connected = useRealtime(enabled);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { try { localStorage.setItem("mr-kds-station", stationId); } catch {} }, [stationId]);
  useEffect(() => { try { localStorage.setItem("mr-kds-sound", sound ? "on" : "off"); } catch {} }, [sound]);
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const summary = useQuery({ queryKey: ["kitchen", "summary"], queryFn: () => api.get<KitchenSummary>("/api/kitchen/summary"), enabled, refetchInterval: 15_000 });
  const tickets = useQuery({
    queryKey: ["kitchen", "tickets", stationId, view],
    queryFn: () => api.get<KitchenTicket[]>(`/api/kitchen/tickets?${stationId !== ALL ? `stationId=${stationId}&` : ""}${view === "done" ? "includeDone=1" : ""}`),
    enabled, refetchInterval: 10_000,
  });

  // Bip + vibration à l'arrivée de nouveaux tickets (compteur global, indépendant du filtre)
  const totalNew = summary.data?.all.counts.NEW;
  useEffect(() => {
    if (totalNew === undefined) return;
    if (newCount.current !== null && totalNew > newCount.current) { if (sound) beep(); try { navigator.vibrate?.(200); } catch {} }
    newCount.current = totalNew;
  }, [totalNew, sound]);

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: KitchenTicket["status"] }) => api.post<KitchenTicket>(`/api/kitchen/tickets/${id}/status`, { status }),
    onMutate: async ({ id, status }) => {
      // Mise à jour optimiste : le ticket change de colonne immédiatement
      const key = ["kitchen", "tickets", stationId, view];
      const prev = qc.getQueryData<KitchenTicket[]>(key);
      if (prev) qc.setQueryData(key, prev.map((t) => (t.id === id ? { ...t, status } : t)));
      return { prev, key };
    },
    onError: (e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev); toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["kitchen"] }); },
  });
  const setItem = useMutation({
    mutationFn: ({ id, itemId, ready }: { id: string; itemId: string; ready: boolean }) => api.post<KitchenTicket>(`/api/kitchen/tickets/${id}/items/${itemId}`, { ready }),
    onError: (e) => toast(e instanceof ApiClientError ? e.message : "Erreur", "error"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["kitchen"] }),
  });

  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen?.().catch(() => toast("Plein écran non disponible sur cet appareil : utilisez « Ajouter à l'écran d'accueil »", "info"));
  }, [toast]);
  const logout = async () => { await api.post("/api/auth/logout"); qc.clear(); router.replace(me?.terminal ? "/pos/login" : "/login"); };

  const list = useMemo(() => {
    const all = tickets.data ?? [];
    if (view === "active") return all.filter((t) => t.status === "NEW" || t.status === "ACCEPTED" || t.status === "IN_PROGRESS");
    if (view === "ready") return all.filter((t) => t.status === "READY");
    return all.filter((t) => t.status === "DONE" || t.status === "CANCELLED").sort((a, b) => new Date(b.completedAt ?? b.createdAt).getTime() - new Date(a.completedAt ?? a.createdAt).getTime());
  }, [tickets.data, view]);

  if (isLoading) return <div className="flex h-dvh items-center justify-center"><Spinner /></div>;
  if (!enabled) {
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <Logo size={44} />
        <p className="mt-6 text-lg font-bold">Écran cuisine</p>
        <p className="mt-2 text-sm text-muted">Votre rôle n&apos;inclut pas la permission « Utiliser l&apos;écran cuisine ». Demandez à un manager d&apos;ajouter <code>kds.use</code> à votre rôle.</p>
        <Link href="/pos" className="mt-6 inline-block rounded-xl bg-brand px-5 py-3 font-semibold text-white">Retour à la caisse</Link>
      </main>
    );
  }

  const stations = summary.data?.stations ?? [];
  const counts = { active: (summary.data?.all.counts.NEW ?? 0) + (summary.data?.all.counts.ACCEPTED ?? 0) + (summary.data?.all.counts.IN_PROGRESS ?? 0), ready: summary.data?.all.counts.READY ?? 0 };
  const stationCount = (s: KitchenSummary["stations"][number]) => s.counts.NEW + s.counts.ACCEPTED + s.counts.IN_PROGRESS + (view === "ready" ? s.counts.READY : 0);

  return (
    <div className="flex h-dvh flex-col">
      <header className="no-print glass flex h-14 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
        <Link href={can("pos.use") ? "/pos" : "/kds"} className="flex items-center gap-2 pr-1" title="Retour à la caisse"><Logo size={30} withText={false} /><span className="hidden items-center gap-1 text-sm font-extrabold md:flex"><ChefHat className="h-4 w-4 text-corail-500" />Cuisine</span></Link>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto no-scrollbar">
          <button onClick={() => setStationId(ALL)} className={`touch flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-bold ${stationId === ALL ? "bg-brand text-white shadow-glow" : "surface-2 text-muted"}`}>Tous<span className={`rounded-full px-1.5 text-[11px] ${stationId === ALL ? "bg-white/20" : "surface-3"}`}>{view === "ready" ? counts.ready : counts.active}</span></button>
          {stations.map((s) => (
            <button key={s.id} onClick={() => setStationId(s.id)} className={`touch flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-bold transition ${stationId === s.id ? "text-white shadow-lift" : "surface-2 text-muted"}`} style={stationId === s.id ? { background: s.color } : undefined}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: stationId === s.id ? "rgb(255 255 255 / 0.8)" : s.color }} />{s.name}
              <span className={`rounded-full px-1.5 text-[11px] ${stationId === s.id ? "bg-white/25" : "surface-3"}`}>{stationCount(s)}</span>
              {s.urgent > 0 && stationId !== s.id ? <Flame className="h-3.5 w-3.5 text-corail-500" /> : null}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="flex rounded-xl surface-2 p-0.5">
            {([["active", "En cours"], ["ready", "Prêts"], ["done", "Historique"]] as [View, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setView(v)} className={`touch flex h-9 items-center gap-1 rounded-[10px] px-2.5 text-xs font-bold ${view === v ? "surface shadow-soft" : "text-muted"}`}>{v === "done" ? <History className="h-3.5 w-3.5" /> : null}<span className={v === "done" ? "hidden sm:inline" : ""}>{label}</span>{v !== "done" ? <span className={`rounded-full px-1.5 text-[10px] ${v === "ready" && counts.ready > 0 ? "bg-green-500 text-white" : "surface-3"}`}>{counts[v]}</span> : null}</button>
            ))}
          </div>
          <span className={`hidden h-9 items-center rounded-full px-2 text-[11px] font-bold sm:flex ${connected ? "bg-green-500/10 text-green-600" : "surface-2 text-muted"}`} title={connected ? "Temps réel actif" : "Temps réel en reconnexion"}>{connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}</span>
          <button onClick={() => setSound((s) => !s)} className={`touch rounded-lg p-2 ${sound ? "text-lagon-600" : "text-muted"}`} title={sound ? "Couper le son" : "Activer le son"}>{sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</button>
          <button onClick={toggleFull} className="touch hidden rounded-lg p-2 sm:block" title="Plein écran">{full ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
          <button onClick={toggle} className="touch hidden rounded-lg p-2 sm:block" aria-label="Changer de thème"><Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" /></button>
          {can("pos.use") ? <Link href="/pos" className="touch hidden rounded-lg p-2 sm:block" title="Caisse"><LayoutGrid className="h-4 w-4" /></Link> : null}
          <button onClick={logout} className="touch flex items-center gap-1.5 rounded-full py-1 pl-1 pr-1 hover:surface-2 sm:pr-2" title="Changer d'utilisateur"><span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: me?.user?.color ?? "#0ea5a4" }}>{(me?.user?.displayName || me?.user?.firstName || "?").slice(0, 1)}</span><LogOut className="hidden h-4 w-4 text-muted sm:block" /></button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
        {tickets.isLoading ? <div className="flex justify-center py-20"><Spinner /></div> : null}
        {!tickets.isLoading && list.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <ChefHat className="h-12 w-12 text-muted/50" />
            <p className="text-lg font-bold">{view === "active" ? "Aucun ticket en attente" : view === "ready" ? "Aucun plat prêt" : "Aucun ticket terminé récemment"}</p>
            <p className="text-sm text-muted">{view === "active" ? "Les envois de la salle apparaissent ici en temps réel." : view === "ready" ? "Les tickets passent ici quand la cuisine appuie sur PRÊT." : "Les tickets terminés des 30 dernières minutes restent consultables et rappelables."}</p>
            {summary.data ? <p className="mt-2 text-xs text-muted">{summary.data.all.doneToday} ticket{summary.data.all.doneToday > 1 ? "s" : ""} aujourd&apos;hui{summary.data.all.avgPrepSec !== null ? ` · temps moyen ${mmss(summary.data.all.avgPrepSec * 1000)}` : ""}</p> : null}
          </div>
        ) : null}
        <div className="grid auto-rows-min grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {list.map((t) => <TicketCard key={t.id} ticket={t} now={now} onStatus={(status) => setStatus.mutate({ id: t.id, status })} onItem={(itemId, ready) => setItem.mutate({ id: t.id, itemId, ready })} busy={setStatus.isPending && setStatus.variables?.id === t.id} />)}
        </div>
      </main>
    </div>
  );
}

function TicketCard({ ticket: t, now, onStatus, onItem, busy }: { ticket: KitchenTicket; now: number; onStatus: (s: KitchenTicket["status"]) => void; onItem: (itemId: string, ready: boolean) => void; busy: boolean }) {
  const elapsedMs = now - new Date(t.createdAt).getTime();
  const warn = (t.station?.warnAfterSec ?? 600) * 1000, alert = (t.station?.alertAfterSec ?? 900) * 1000;
  const closed = t.status === "DONE" || t.status === "CANCELLED";
  const level = closed || t.status === "READY" ? "none" : elapsedMs >= alert ? "alert" : elapsedMs >= warn ? "warn" : "none";
  const color = t.status === "READY" ? "#22c55e" : t.status === "DONE" ? "#64748b" : t.status === "CANCELLED" ? "#ef4444" : level === "alert" ? "#dc2626" : level === "warn" ? "#f59e0b" : (t.station?.color ?? "#14aaa3");
  const live = t.items.filter((i) => i.status !== "VOIDED");
  const readyCount = live.filter((i) => i.status === "READY" || i.status === "SERVED").length;
  const where = t.order.table ? `T${t.order.table.name.replace(/^T/i, "")}` : ORDER_TYPE_LABEL[t.order.type];
  const action: { label: string; status: KitchenTicket["status"]; variant: string } | null =
    t.status === "NEW" ? { label: "ACCEPTER", status: "ACCEPTED", variant: "bg-nuit-800 text-white dark:bg-lagon-500 dark:text-nuit-950" }
    : t.status === "ACCEPTED" ? { label: "EN PRÉPARATION", status: "IN_PROGRESS", variant: "bg-accent text-white" }
    : t.status === "IN_PROGRESS" ? { label: "PRÊT", status: "READY", variant: "bg-green-600 text-white" }
    : t.status === "READY" ? { label: "TERMINÉ", status: "DONE", variant: "bg-brand text-white" }
    : t.status === "DONE" ? { label: "RAPPELER", status: "READY", variant: "surface-2 text-[var(--text)] border border-line" } : null;

  return (
    <article className={`card flex flex-col overflow-hidden ${level === "alert" ? "pulse-soft ring-2 ring-red-500/60" : ""} ${closed ? "opacity-80" : ""}`} style={{ borderColor: level !== "none" ? color : undefined }}>
      <header className="flex items-center gap-2 px-3 py-2 text-white" style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 72%, black))` }}>
        <span className="text-2xl font-extrabold leading-none tracking-tight">{where}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-xs font-bold uppercase tracking-wide">{t.course?.name ?? "Commande"}{t.station ? ` · ${t.station.name}` : ""}</span>
          <span className="block truncate text-[11px] opacity-90">n° {t.order.number.split("-")[1] ?? t.order.number} · {t.order.covers} couv. · {t.order.server?.displayName || t.order.server?.firstName}{t.order.customerName ? ` · ${t.order.customerName}` : ""}</span>
        </span>
        <span className="text-right leading-tight">
          <span className="block font-mono text-xl font-extrabold tabular-nums">{closed ? TICKET_STATUS_LABEL[t.status] : mmss(elapsedMs)}</span>
          {t.isUrgent && !closed ? <span className="flex items-center justify-end gap-1 text-[10px] font-extrabold uppercase"><Flame className="h-3 w-3" />Urgent</span> : <span className="block text-[10px] font-semibold uppercase opacity-80">{TICKET_STATUS_LABEL[t.status]}</span>}
        </span>
      </header>
      <ul className="flex-1 divide-y divide-[var(--border)]">
        {t.items.map((i) => {
          const voided = i.status === "VOIDED";
          const done = i.status === "READY" || i.status === "SERVED";
          return (
            <li key={i.id}>
              <button disabled={voided || closed} onClick={() => onItem(i.id, !done)} className={`touch flex w-full items-start gap-2.5 px-3 py-2 text-left transition ${done ? "opacity-55" : ""} ${voided ? "opacity-40" : "hover:surface-2"}`}>
                <span className={`mt-0.5 flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 text-base font-extrabold ${done ? "bg-green-500/20 text-green-700 dark:text-green-300" : voided ? "bg-red-500/15 text-red-600" : "surface-2"}`}>{done ? <Check className="h-5 w-5" /> : i.quantity}</span>
                <span className="min-w-0 flex-1">
                  <span className={`flex items-center gap-1.5 text-[15px] font-bold leading-tight ${done || voided ? "line-through" : ""}`}>{i.isUrgent ? <Flame className="h-4 w-4 shrink-0 text-corail-500" /> : null}{done ? "" : `${i.quantity} × `}{i.name}</span>
                  {i.parentItem ? <span className="block text-xs text-muted">↳ {i.parentItem.name}</span> : null}
                  {i.modifiers.length ? <span className="block text-sm font-semibold text-lagon-700 dark:text-lagon-300">{i.modifiers.map((m) => m.name).join(" · ")}</span> : null}
                  {i.notes ? <span className="block text-sm font-semibold italic text-corail-500">« {i.notes} »</span> : null}
                  {voided ? <span className="block text-[11px] font-bold uppercase text-red-600">Annulé</span> : null}
                </span>
                {i.seatNumber ? <span className="rounded-md surface-2 px-1.5 py-0.5 text-[11px] font-bold text-muted">C{i.seatNumber}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {t.order.notes ? <p className="border-t border-line px-3 py-1.5 text-xs italic text-muted">Commande : « {t.order.notes} »</p> : null}
      <footer className="flex items-center gap-1.5 border-t border-line p-2">
        <a href={`/api/kitchen/tickets/${t.id}/print?format=html&print=1`} target="_blank" rel="noreferrer" className="touch flex h-12 w-12 shrink-0 items-center justify-center rounded-xl surface-2 text-muted hover:surface-3" title="Imprimer le bon cuisine"><Printer className="h-5 w-5" /></a>
        {t.status === "READY" ? <button onClick={() => onStatus("IN_PROGRESS")} className="touch flex h-12 w-12 shrink-0 items-center justify-center rounded-xl surface-2 text-muted hover:surface-3" title="Retour en préparation"><RotateCcw className="h-5 w-5" /></button> : null}
        {action ? <button disabled={busy} onClick={() => onStatus(action.status)} className={`touch flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-extrabold tracking-wide transition active:scale-[0.98] disabled:opacity-60 ${action.variant}`}>{action.label}{live.length > 1 && !closed && t.status !== "READY" ? <span className="rounded-full bg-white/20 px-1.5 text-[11px]">{readyCount}/{live.length}</span> : null}</button> : <span className="flex-1 text-center text-xs font-bold uppercase text-red-600">Annulé</span>}
      </footer>
    </article>
  );
}
