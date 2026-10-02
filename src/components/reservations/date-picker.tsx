"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api-client";
import { addDays } from "@/lib/dates";
import type { DaySummary } from "./shared";

const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const addMonths = (first: string, n: number) => { const d = new Date(`${first}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n, 1); return d.toISOString().slice(0, 10); };
const daysIn = (first: string) => new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0)).getUTCDate();
const monthLabel = (first: string) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T12:00:00Z`));

/**
 * Calendrier du mois (sans le sélecteur de date du navigateur, peu lisible et capricieux sur Safari) :
 * les jours réservés portent leurs couverts, aujourd'hui est entouré.
 */
export function DatePicker({ value, today, onChange, min, label = "Choisir une date", className = "" }: { value: string; today: string; onChange: (day: string) => void; min?: string; label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(monthStart(value));
  const summary = useQuery({ queryKey: ["reservations-summary", month, "month"], queryFn: () => api.get<DaySummary[]>(`/api/reservations/summary?from=${month}&days=${daysIn(month)}`), enabled: open });
  const lead = (new Date(`${month}T12:00:00Z`).getUTCDay() + 6) % 7; // lundi en premier
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysIn(month) }, (_, i) => addDays(month, i))];
  const pick = (d: string) => { onChange(d); setOpen(false); };
  return (
    <div className={`relative ${className}`}>
      <button type="button" onClick={() => { setMonth(monthStart(value)); setOpen(!open); }} aria-expanded={open} aria-label={label} className="touch flex h-11 items-center gap-2 rounded-xl border border-line surface px-3 text-sm font-bold hover:surface-2">
        <CalendarDays className="h-4 w-4 text-lagon-600" /><span>{label}</span>
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div role="dialog" aria-label="Calendrier" className="rise absolute right-0 z-50 mt-2 w-[min(92vw,340px)] rounded-3xl border border-line surface p-3 shadow-2xl" data-testid="date-picker">
            <div className="mb-2 flex items-center">
              <button type="button" onClick={() => setMonth(addMonths(month, -1))} className="touch flex h-9 w-9 items-center justify-center rounded-xl hover:surface-2" aria-label="Mois précédent"><ChevronLeft className="h-5 w-5" /></button>
              <p className="flex-1 text-center text-base font-extrabold capitalize">{monthLabel(month)}</p>
              <button type="button" onClick={() => setMonth(addMonths(month, 1))} className="touch flex h-9 w-9 items-center justify-center rounded-xl hover:surface-2" aria-label="Mois suivant"><ChevronRight className="h-5 w-5" /></button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center">
              {["L", "M", "M", "J", "V", "S", "D"].map((d, i) => <span key={i} className="text-[11px] font-bold text-muted">{d}</span>)}
              {cells.map((d, i) => {
                if (!d) return <span key={`x${i}`} />;
                const s = summary.data?.find((x) => x.day === d);
                const sel = d === value, isToday = d === today, off = !!min && d < min;
                return (
                  <button key={d} type="button" disabled={off} onClick={() => pick(d)} aria-label={d} aria-pressed={sel}
                    className={`touch relative flex h-11 flex-col items-center justify-center rounded-xl text-sm font-bold transition disabled:opacity-25 ${sel ? "bg-brand text-white shadow-glow" : isToday ? "ring-2 ring-lagon-500" : "hover:surface-2"}`}>
                    {Number(d.slice(8))}
                    {s?.covers ? <span className={`text-[9px] font-extrabold leading-none ${sel ? "text-white/90" : "text-lagon-600"}`}>{s.covers}</span> : null}
                    {s?.pending ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-xs text-muted">
              <span>Chiffre : couverts réservés</span>
              <button type="button" onClick={() => pick(today)} className="font-bold text-lagon-700 underline dark:text-lagon-300">Aujourd&apos;hui</button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
