"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Clock3, X, ChevronRight, AlarmClock } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import type { listReminders } from "@/server/services/service-tracking";

export type Reminders = Awaited<ReturnType<typeof listReminders>>;
export type Reminder = Reminders["due"][number];

export const KIND_SHORT: Record<string, string> = { BRING: "À apporter", TAKE_ORDER: "Commande", CHECK: "Vérifier", DESSERT: "Dessert ?", BILL: "Addition", CUSTOM: "Rappel" };
export const KIND_COLOR: Record<string, string> = { BRING: "#16a34a", TAKE_ORDER: "#f97c3c", CHECK: "#2a78d6", DESSERT: "#4a3aa7", BILL: "#a855f7", CUSTOM: "#64748b" };

/** Bip court (deux notes) sans fichier audio ; silencieux si le navigateur l'interdit. */
function beep() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.06;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.frequency.setValueAtTime(1175, ctx.currentTime + 0.12); o.stop(ctx.currentTime + 0.28);
    setTimeout(() => ctx.close().catch(() => {}), 600);
  } catch { /* audio indisponible */ }
}

/** Rappels de service : rafraîchis toutes les 20 s et par le temps réel ; son/vibration une seule fois par rappel. */
export function useServiceReminders(enabled = true) {
  const q = useQuery({ queryKey: ["service", "reminders"], queryFn: () => api.get<Reminders>("/api/service/reminders"), refetchInterval: 20_000, enabled, placeholderData: (prev) => prev });
  const notified = useRef<Set<string>>(new Set());
  const first = useRef(true);
  useEffect(() => {
    const d = q.data;
    if (!d) return;
    const fresh = d.due.filter((r) => !notified.current.has(r.id));
    for (const r of d.due) notified.current.add(r.id);
    if (first.current) { first.current = false; return; } // pas d'alerte au chargement de la page
    if (fresh.length === 0) return;
    if (d.settings.sound) beep();
    if (d.settings.vibrate && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.([120, 60, 120]);
  }, [q.data]);
  return q;
}

export function useReminderActions() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const refresh = () => { qc.invalidateQueries({ queryKey: ["service"] }); qc.invalidateQueries({ queryKey: ["floor"] }); qc.invalidateQueries({ queryKey: ["orders"] }); };
  const dropLocal = (id: string) => qc.setQueryData<Reminders>(["service", "reminders"], (d) => (d ? { ...d, due: d.due.filter((r) => r.id !== id), upcoming: d.upcoming.filter((r) => r.id !== id) } : d));
  const done = async (r: { id: string; orderId: string }) => {
    dropLocal(r.id);
    try { await api.post(`/api/service/reminders/${r.id}/done`, {}, { queueIfOffline: true, idempotencyKey: `done-${r.id}` }); qc.invalidateQueries({ queryKey: ["order", r.orderId] }); }
    catch (e) { if (!(e instanceof ApiClientError && e.code === "QUEUED")) toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); }
    finally { refresh(); }
  };
  const snooze = async (r: { id: string }, minutes: number) => {
    dropLocal(r.id);
    try { await api.post(`/api/service/reminders/${r.id}/snooze`, { minutes }, { queueIfOffline: true, idempotencyKey: `snooze-${r.id}-${Date.now()}` }); toast(`Reporté de ${minutes} min`, "info"); }
    catch (e) { if (!(e instanceof ApiClientError && e.code === "QUEUED")) toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); }
    finally { refresh(); }
  };
  return { done, snooze };
}

function Row({ r, upcoming }: { r: Reminder; upcoming?: boolean }) {
  const { done, snooze } = useReminderActions();
  const [menu, setMenu] = useState(false);
  const color = KIND_COLOR[r.kind];
  return (
    <li className={`card relative p-3 ${r.late ? "ring-2 ring-red-500/60" : ""} ${upcoming ? "opacity-70" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl text-white" style={{ background: color }}><span className="text-sm font-extrabold leading-none">{r.tableName ?? "—"}</span><span className="mt-0.5 text-[9px] font-bold uppercase opacity-90">{KIND_SHORT[r.kind]}</span></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight">{r.label}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
            {r.server ? <span className="inline-flex items-center gap-1"><span className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-extrabold text-white" style={{ background: r.server.color ?? "#334155" }}>{r.server.initials}</span>{r.server.name}</span> : <span>Équipe</span>}
            <span className={r.late ? "font-bold text-red-600" : ""}>{upcoming ? `dans ${r.dueInMin} min` : r.waitingMin === 0 ? "maintenant" : `depuis ${r.waitingMin} min`}{r.late ? " · en retard" : ""}</span>
            {r.snoozeCount ? <span>reporté ×{r.snoozeCount}</span> : null}
          </p>
        </div>
        <Link href={`/pos/order/${r.orderId}`} className="touch flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:surface-2" title="Ouvrir la table" aria-label="Ouvrir la table"><ChevronRight className="h-4 w-4" /></Link>
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={() => done(r)} className="touch flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand text-sm font-bold text-white shadow-glow"><Check className="h-4 w-4" />Fait</button>
        <div className="relative">
          <button onClick={() => setMenu(!menu)} className="touch flex h-10 items-center gap-1.5 rounded-xl surface-2 px-3 text-sm font-semibold"><AlarmClock className="h-4 w-4" />Reporter</button>
          {menu ? <div className="absolute right-0 top-full z-20 mt-1 flex overflow-hidden rounded-xl border border-line surface shadow-lift">{[5, 10, 15].map((m) => <button key={m} onClick={() => { setMenu(false); snooze(r, m); }} className="touch px-3 py-2 text-sm font-semibold hover:surface-2">{m} min</button>)}</div> : null}
        </div>
      </div>
    </li>
  );
}

/** Panneau « À faire maintenant » : rappels dus classés par priorité, puis les prochains. */
export function TodoPanel({ open, onClose, data }: { open: boolean; onClose: () => void; data?: Reminders }) {
  const due = data?.due ?? [], upcoming = data?.upcoming ?? [];
  return (
    <div className={`fixed inset-0 z-[55] overflow-hidden ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-black/40 transition-opacity ${open ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <aside className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col surface shadow-2xl transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`} style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }} role="dialog" aria-label="À faire maintenant" data-testid="todo-panel">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white"><BellRing className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1"><h2 className="text-base font-extrabold leading-tight">À faire maintenant</h2><p className="text-xs text-muted">{due.length ? `${due.length} action${due.length > 1 ? "s" : ""}${due.some((r) => r.late) ? ` · ${due.filter((r) => r.late).length} en retard` : ""}` : "Rien d'urgent, tout est à jour"}</p></div>
          <button onClick={onClose} className="touch flex h-10 w-10 items-center justify-center rounded-xl surface-2" aria-label="Fermer"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {data?.settings.enabled === false ? <p className="card p-4 text-sm text-muted">Le suivi de service est désactivé. Activez-le dans Administration → Paramètres → Suivi de service.</p> : null}
          {due.length ? <ul className="space-y-2">{due.map((r) => <Row key={r.id} r={r} />)}</ul> : data?.settings.enabled !== false ? <p className="card flex items-center gap-2 p-4 text-sm text-muted"><Check className="h-4 w-4 text-lagon-600" />Aucune action en attente.</p> : null}
          {upcoming.length ? <><p className="mb-2 mt-4 flex items-center gap-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-muted"><Clock3 className="h-3.5 w-3.5" />À venir</p><ul className="space-y-2">{upcoming.map((r) => <Row key={r.id} r={r} upcoming />)}</ul></> : null}
        </div>
      </aside>
    </div>
  );
}

/** Bouton d'en-tête avec compteur (rouge s'il y a du retard). */
export function TodoButton({ count, late, onClick, compact }: { count: number; late: boolean; onClick: () => void; compact?: boolean }) {
  return (
    <button onClick={onClick} className={`touch relative flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition ${count ? (late ? "bg-red-600 text-white" : "bg-corail-500 text-white shadow-[0_8px_20px_-8px_rgb(249_124_60/0.6)]") : "surface-2 text-muted"}`} title="À faire maintenant" aria-label="À faire maintenant" data-testid="todo-button">
      <BellRing className={`h-4 w-4 ${count && late ? "animate-pulse" : ""}`} />{compact ? null : <span className="hidden lg:inline">À faire</span>}
      {count ? <span className={`ml-0.5 rounded-full px-1.5 text-[11px] font-extrabold ${count ? "bg-white/25" : ""}`}>{count}</span> : null}
    </button>
  );
}
