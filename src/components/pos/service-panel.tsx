"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, SkipForward, Ban, RotateCcw, UserRound, Clock3, AlarmClock, ChefHat, Utensils, Send, Receipt, Flag } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useToast } from "@/components/ui/toast";
import { formatTime } from "@/lib/dates";
import type { orderTimeline } from "@/server/services/service-tracking";
import { KIND_COLOR, KIND_SHORT, useReminderActions } from "./service-todo";

type Timeline = Awaited<ReturnType<typeof orderTimeline>>;
type UserRow = { id: string; firstName: string; lastName: string; displayName: string | null; color: string | null; isActive: boolean };

const STEP_STYLE: Record<string, string> = { DONE: "bg-green-500/15 text-green-700 dark:text-green-400", SKIPPED: "bg-slate-500/15 text-muted", NOT_NEEDED: "bg-slate-500/15 text-muted", PENDING: "surface-2 text-muted" };
const STEP_LABEL: Record<string, string> = { DONE: "fait", SKIPPED: "ignoré", NOT_NEEDED: "non nécessaire", PENDING: "à faire" };
const EVENT_ICON: Record<string, React.ReactNode> = { seated: <Utensils className="h-3.5 w-3.5" />, sent: <Send className="h-3.5 w-3.5" />, ready: <ChefHat className="h-3.5 w-3.5" />, served: <Check className="h-3.5 w-3.5" />, step: <Flag className="h-3.5 w-3.5" />, reminder: <AlarmClock className="h-3.5 w-3.5" />, bill: <Receipt className="h-3.5 w-3.5" />, closed: <Check className="h-3.5 w-3.5" /> };

/** Onglet « Service » d'une table : prochaine action, serveur, étapes du parcours et chronologie. */
export function ServicePanel({ orderId, closed }: { orderId: string; closed: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { timezone, me } = useSession();
  const { done, snooze } = useReminderActions();
  const q = useQuery({ queryKey: ["service", "timeline", orderId], queryFn: () => api.get<Timeline>(`/api/service/orders/${orderId}/timeline`), refetchInterval: 20_000, placeholderData: (p) => p });
  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<UserRow[]>("/api/users"), staleTime: 300_000, enabled: !closed });
  const [stepMenu, setStepMenu] = useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["service"] }); qc.invalidateQueries({ queryKey: ["order", orderId] }); qc.invalidateQueries({ queryKey: ["floor"] }); };
  const setStep = async (key: string, status: "DONE" | "SKIPPED" | "NOT_NEEDED" | "PENDING") => {
    setStepMenu(null);
    const reason = status === "SKIPPED" || status === "NOT_NEEDED" ? (window.prompt("Raison (facultatif)") ?? undefined) : undefined;
    try { await api.post(`/api/service/orders/${orderId}/steps/${key}`, { status, reason: reason || null }, { queueIfOffline: true }); } catch { toast("Étape non enregistrée", "error"); }
    refresh();
  };
  const assign = async (serverId: string) => { try { await api.post(`/api/service/orders/${orderId}/server`, { serverId: serverId || null }); toast("Serveur attribué", "success"); } catch { toast("Attribution impossible", "error"); } refresh(); };
  const d = q.data;
  if (!d) return <p className="p-4 text-sm text-muted">Chargement du suivi…</p>;
  if (!d.enabled) return <p className="p-4 text-sm text-muted">Le suivi de service est désactivé (Administration → Paramètres).</p>;
  const next = d.next;
  return (
    <div className="space-y-3 p-3">
      {/* Prochaine action */}
      {next ? (
        <div className={`rounded-2xl p-3 text-white ${next.late ? "bg-red-600" : ""}`} style={next.late ? undefined : { background: KIND_COLOR[next.kind] }}>
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-85">{closed ? "Dernière étape" : next.due ? (next.late ? "En retard" : "À faire maintenant") : next.dueAt ? `Prochaine action · dans ${Math.max(1, next.dueInMin)} min` : "Prochaine étape"}</p>
          <p className="mt-0.5 text-sm font-extrabold leading-tight">{next.label}</p>
          {!closed && next.id ? <div className="mt-2 flex gap-2"><button onClick={() => done({ id: next.id!, orderId })} className="touch flex h-9 flex-1 items-center justify-center gap-1 rounded-xl bg-white/20 text-sm font-bold"><Check className="h-4 w-4" />Fait</button><button onClick={() => snooze({ id: next.id! }, 5)} className="touch flex h-9 items-center justify-center gap-1 rounded-xl bg-white/20 px-3 text-sm font-bold"><AlarmClock className="h-4 w-4" />+5 min</button></div> : null}
        </div>
      ) : <p className="rounded-2xl surface-2 p-3 text-sm text-muted">Parcours terminé, aucune action en attente.</p>}
      {/* Serveur responsable */}
      <div className="flex items-center gap-2 rounded-2xl surface-2 p-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-white" style={{ background: d.server?.color ?? "#334155" }}>{d.server?.initials ?? <UserRound className="h-4 w-4" />}</span>
        {closed ? <span className="text-sm font-semibold">{d.server?.name ?? "Sans serveur"}</span> : (
          <select value={d.server?.id ?? ""} onChange={(e) => assign(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-line surface px-2 text-sm font-semibold" aria-label="Serveur responsable">
            <option value="">Sans serveur attribué</option>
            {(users.data ?? []).filter((u) => u.isActive || u.id === d.server?.id).map((u) => <option key={u.id} value={u.id}>{u.displayName || `${u.firstName} ${u.lastName}`}{u.id === me?.user?.id ? " (moi)" : ""}</option>)}
          </select>
        )}
      </div>
      {/* Étapes */}
      <div>
        <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">Parcours de service</p>
        <ol className="space-y-1">
          {d.steps.map((st, i) => (
            <li key={st.key} className="relative">
              <button disabled={closed} onClick={() => setStepMenu(stepMenu === st.key ? null : st.key)} className="touch flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left hover:surface-2 disabled:opacity-80">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold ${st.status === "DONE" ? "bg-green-600 text-white" : st.status === "PENDING" ? "surface-3 text-muted" : "bg-slate-400 text-white"}`}>{st.status === "DONE" ? <Check className="h-3.5 w-3.5" /> : st.status === "PENDING" ? i + 1 : <Ban className="h-3 w-3" />}</span>
                <span className="min-w-0 flex-1"><span className={`block text-xs font-semibold leading-tight ${st.status !== "PENDING" && st.status !== "DONE" ? "text-muted line-through" : ""}`}>{st.label}</span>{st.reason ? <span className="block text-[11px] text-muted">{st.reason}</span> : null}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STEP_STYLE[st.status]}`}>{STEP_LABEL[st.status]}{st.doneAt ? ` · ${formatTime(st.doneAt, timezone)}` : ""}</span>
              </button>
              {stepMenu === st.key ? (
                <div className="absolute right-2 top-full z-20 mt-1 flex overflow-hidden rounded-xl border border-line surface shadow-lift">
                  {st.status !== "DONE" ? <button onClick={() => setStep(st.key, "DONE")} className="touch flex items-center gap-1 px-3 py-2 text-xs font-bold text-green-700 hover:surface-2"><Check className="h-3.5 w-3.5" />Fait</button> : null}
                  {st.status === "PENDING" ? <><button onClick={() => setStep(st.key, "SKIPPED")} className="touch flex items-center gap-1 px-3 py-2 text-xs font-semibold hover:surface-2"><SkipForward className="h-3.5 w-3.5" />Ignoré</button><button onClick={() => setStep(st.key, "NOT_NEEDED")} className="touch flex items-center gap-1 px-3 py-2 text-xs font-semibold hover:surface-2"><Ban className="h-3.5 w-3.5" />Pas nécessaire</button></> : <button onClick={() => setStep(st.key, "PENDING")} className="touch flex items-center gap-1 px-3 py-2 text-xs font-semibold hover:surface-2"><RotateCcw className="h-3.5 w-3.5" />Rouvrir</button>}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      {/* Chronologie */}
      <div>
        <p className="mb-1.5 px-1 text-[11px] font-bold uppercase tracking-wider text-muted">Chronologie</p>
        <ol className="relative ml-3 border-l border-line pl-4">
          {d.events.map((e, i) => (
            <li key={i} className="relative pb-3 last:pb-0">
              <span className={`absolute -left-[25px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-white ${e.kind === "served" || e.kind === "closed" ? "bg-green-600" : e.kind === "ready" ? "bg-lagon-500" : e.kind === "sent" ? "bg-corail-500" : "bg-slate-400"}`}>{EVENT_ICON[e.kind]}</span>
              <p className="text-xs font-semibold leading-tight">{e.label}<span className="ml-1.5 font-normal text-muted"><Clock3 className="mr-0.5 inline h-3 w-3" />{formatTime(e.at, timezone)}</span></p>
              {e.detail ? <p className="text-[11px] text-muted">{e.detail}</p> : null}
            </li>
          ))}
        </ol>
        {d.reminders.length ? <p className="mt-2 px-1 text-[11px] text-muted">{d.reminders.length} rappel{d.reminders.length > 1 ? "s" : ""} en attente : {d.reminders.map((r) => KIND_SHORT[r.kind]).join(", ")}</p> : null}
      </div>
    </div>
  );
}
