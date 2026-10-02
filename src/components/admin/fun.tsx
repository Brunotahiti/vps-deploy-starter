"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronRight, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { celebrate } from "@/lib/celebrate";
import { formatMoney } from "@/lib/money";
import type { StartStep } from "@/server/services/getting-started";

/*
 * Touches « ludiques » du tableau de bord : un accueil personnel, l'objectif du jour avec ses paliers,
 * et la liste « Bien démarrer » des nouveaux comptes. Les célébrations ne jouent qu'une fois (mémoire de l'appareil).
 */

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
};

/** Salutation selon l'heure du restaurant. */
export function greeting(firstName: string | undefined, timezone: string, now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(now));
  const day = hour >= 5 && hour < 18;
  const hello = day ? "Bonjour" : "Bonsoir";
  const mood = !day ? (hour >= 18 && hour < 23 ? "Bonne soirée de service 🌙" : "Belle nuit 🌙") : hour < 11 ? "Belle journée qui commence ☀️" : hour < 15 ? "Bon service ! 🍽️" : "Bel après-midi 🌺";
  return { title: `${hello}${firstName ? ` ${firstName}` : ""} 👋`, mood };
}

const WEEKDAY = ["dimanches", "lundis", "mardis", "mercredis", "jeudis", "vendredis", "samedis"];

/**
 * Objectif du jour : la moyenne des mêmes jours de la semaine sur les 4 dernières semaines (sinon des jours passés).
 * Paliers 🌱 50 %, 🌴 100 %, 🏆 record.
 */
export function goalOf(day: string, history: { day: string; revenue: number }[]) {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  const past = history.filter((h) => h.day < day && h.revenue > 0);
  const same = past.filter((h) => new Date(`${h.day}T12:00:00Z`).getUTCDay() === dow);
  const pool = same.length ? same : past;
  if (!pool.length) return null;
  const target = Math.round(pool.reduce((a, h) => a + h.revenue, 0) / pool.length);
  const record = Math.max(...past.map((h) => h.revenue));
  return { target, record, label: same.length ? `moyenne des ${same.length > 1 ? `${same.length} derniers` : "derniers"} ${WEEKDAY[dow]}` : "moyenne des derniers jours" };
}

export function DayGoal({ day, revenue, history, currency }: { day: string; revenue: number; history: { day: string; revenue: number }[]; currency: string }) {
  const goal = goalOf(day, history);
  const reached = !!goal && goal.target > 0 && revenue >= goal.target;
  const isRecord = !!goal && revenue > goal.record && goal.record > 0;
  // Objectif atteint ou record battu : une seule célébration par jour et par appareil
  useEffect(() => {
    if (!reached) return;
    const key = `mr-goal-${day}${isRecord ? "-record" : ""}`;
    if (store.get(key)) return;
    store.set(key, "1");
    celebrate();
  }, [reached, isRecord, day]);
  if (!goal || goal.target <= 0) return null;
  const pct = Math.min(100, Math.round((revenue / goal.target) * 100));
  const left = goal.target - revenue;
  const msg = isRecord ? "🏆 Nouveau record ! Bravo à toute l'équipe" : reached ? "🌴 Objectif atteint, magnifique !" : pct >= 50 ? `🌱 Plus que ${formatMoney(left, currency)} pour l'objectif` : `Objectif ${formatMoney(goal.target, currency)} : c'est parti !`;
  return (
    <div className="mt-4" data-testid="day-goal">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] font-semibold text-white/80">
        <span>Objectif du jour · {goal.label}</span><span className="tabular-nums">{pct} %</span>
      </div>
      <div className="relative h-3 rounded-full bg-white/20">
        <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-white transition-all duration-700" style={{ width: `${pct}%` }} />
        {[50, 100].map((m) => <span key={m} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-sm" style={{ left: `${m === 100 ? 97 : m}%` }} aria-hidden>{m === 50 ? "🌱" : reached ? "🏆" : "🌴"}</span>)}
      </div>
      <p className="mt-1.5 text-sm font-bold">{msg}</p>
    </div>
  );
}

type Start = { steps: StartStep[]; done: number; total: number; established: boolean };

/** « Bien démarrer » : étapes cochées toutes seules ; se retire une fois tout fait (après un bravo). */
export function GettingStarted({ establishmentId }: { establishmentId: string }) {
  const key = `mr-start-hidden-${establishmentId}`;
  const cheerKey = `mr-start-cheered-${establishmentId}`;
  const [hidden, setHidden] = useState(() => store.get(key) === "1");
  const [cheeredBefore] = useState(() => store.get(cheerKey) === "1");
  const q = useQuery({ queryKey: ["getting-started"], queryFn: () => api.get<Start>("/api/getting-started"), enabled: !hidden, refetchInterval: 60_000 });
  const d = q.data;
  const complete = !!d && d.done === d.total;
  const cheer = complete && !d.established && !cheeredBefore;
  useEffect(() => {
    if (!cheer) return;
    store.set(cheerKey, "1");
    celebrate({ count: 90 });
  }, [cheer, cheerKey]);
  // Rien à montrer : masqué, compte déjà bien installé, ou mise en route terminée et déjà fêtée
  if (hidden || !d || d.established || (complete && cheeredBefore)) return null;
  const hide = () => { store.set(key, "1"); setHidden(true); };
  const pct = Math.round((d.done / d.total) * 100);
  const next = d.steps.find((s) => !s.done);
  return (
    <section className="card relative mb-4 overflow-hidden p-4 sm:p-5" data-testid="getting-started">
      <button onClick={hide} className="touch absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:surface-2" aria-label="Masquer « Bien démarrer »"><X className="h-4 w-4" /></button>
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 shrink-0" aria-label={`${d.done} étapes sur ${d.total}`}>
          <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90"><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--viz-grid)" strokeWidth="4" /><circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--viz-1)" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(pct / 100) * 97.4} 97.4`} className="transition-all duration-700" /></svg>
          <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold">{d.done}/{d.total}</span>
        </div>
        <div className="min-w-0 pr-8">
          <h2 className="text-base font-extrabold tracking-tight">{complete ? "🎉 Votre restaurant est prêt !" : "🚀 Bien démarrer"}</h2>
          <p className="text-xs text-muted">{complete ? "Toutes les étapes sont faites. Bon service avec ManaResto !" : next ? <>Prochaine étape : <b className="text-[var(--text)]">{next.title}</b></> : null}</p>
        </div>
      </div>
      {!complete ? (
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {d.steps.map((s, i) => (
            <li key={s.key}>
              <Link href={s.href} className={`group flex items-center gap-3 rounded-2xl border p-3 transition ${s.done ? "border-transparent bg-emerald-500/8" : s === next ? "border-lagon-400 bg-lagon-500/5 hover:bg-lagon-500/10" : "border-line hover:surface-2"}`}>
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${s.done ? "bg-emerald-500 text-white" : "surface-2 text-muted"}`}>{s.done ? <Check className="h-4 w-4" /> : i + 1}</span>
                <span className="min-w-0 flex-1"><span className={`block text-sm font-bold ${s.done ? "text-muted line-through decoration-emerald-500/60" : ""}`}>{s.title}</span><span className="block truncate text-[11px] text-muted">{s.hint}</span></span>
                {!s.done ? <ChevronRight className="h-4 w-4 shrink-0 text-muted transition group-hover:translate-x-0.5" /> : null}
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <button onClick={hide} className="mt-3 text-xs font-semibold text-lagon-600">Masquer ce message</button>
      )}
    </section>
  );
}
