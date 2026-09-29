"use client";

import { formatMoney } from "@/lib/money";

/** Graphique en barres SVG, sans dépendance. */
export function BarChart({ data, currency = "XPF", height = 160, color = "#0ea5a4", valueLabel }: { data: { label: string; value: number; secondary?: number }[]; currency?: string; height?: number; color?: string; valueLabel?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.secondary ?? 0)));
  const fmt = valueLabel ?? ((v: number) => formatMoney(v, currency));
  if (data.length === 0) return <p className="py-8 text-center text-sm text-muted">Aucune donnée</p>;
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-end gap-1" style={{ height, minWidth: data.length * 28 }}>
        {data.map((d, i) => (
          <div key={i} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.label} : ${fmt(d.value)}`}>
            {d.secondary !== undefined ? <div className="absolute bottom-0 left-0 w-1/2 rounded-t bg-slate-400/40" style={{ height: `${(d.secondary / max) * 100}%` }} /> : null}
            <div className="relative rounded-t transition group-hover:brightness-110" style={{ height: `${Math.max(2, (d.value / max) * 100)}%`, background: color, marginLeft: d.secondary !== undefined ? "50%" : 0, width: d.secondary !== undefined ? "50%" : "100%" }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1" style={{ minWidth: data.length * 28 }}>{data.map((d, i) => <div key={i} className="flex-1 truncate text-center text-[10px] text-muted">{d.label}</div>)}</div>
    </div>
  );
}

export function HBars({ data, currency = "XPF", color = "#0ea5a4", valueLabel }: { data: { label: string; value: number; hint?: string }[]; currency?: string; color?: string; valueLabel?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const fmt = valueLabel ?? ((v: number) => formatMoney(v, currency));
  if (data.length === 0) return <p className="py-6 text-center text-sm text-muted">Aucune donnée</p>;
  return (
    <div className="space-y-2">
      {data.map((d, i) => (
        <div key={i}>
          <div className="mb-0.5 flex justify-between text-xs"><span className="truncate font-semibold">{d.label}{d.hint ? <span className="ml-1 font-normal text-muted">{d.hint}</span> : null}</span><span className="tabular-nums">{fmt(d.value)}</span></div>
          <div className="h-2 rounded-full surface-2"><div className="h-2 rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}

export function Stat({ label, value, delta, hint }: { label: string; value: React.ReactNode; delta?: number | null; hint?: string }) {
  return (
    <div className="surface rounded-2xl border p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p>
      {delta !== undefined && delta !== null ? <p className={`text-xs font-semibold ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>{delta >= 0 ? "+" : ""}{delta.toFixed(1)} % vs J-7</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
