"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Table2, BarChart3 } from "lucide-react";
import { formatMoney } from "@/lib/money";

/*
 * Graphiques ManaResto — SVG/HTML sans dépendance.
 * Règles : une série = une couleur (slot 1), marques fines (≤ 24 px), extrémités arrondies, grille en filet,
 * survol avec info-bulle sur chaque marque, libellés directs uniquement sur les valeurs qui comptent,
 * vue « tableau » pour chaque graphique, animations respectant « réduire les animations ».
 */

export const SERIES = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)"];

/** Valeur compacte pour les axes et libellés directs (12,3 k F, 1,2 M F). */
export function compact(v: number, currency?: string) {
  const abs = Math.abs(v);
  const unit = currency ? " F" : "";
  if (abs >= 1_000_000) return `${(v / 1_000_000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} M${unit}`;
  if (abs >= 10_000) return `${Math.round(v / 1000).toLocaleString("fr-FR")} k${unit}`;
  if (abs >= 1_000) return `${(v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k${unit}`;
  return `${Math.round(v).toLocaleString("fr-FR")}${unit}`;
}

/** Bornes « propres » d'un axe : 0 → un multiple agréable ≥ max, en 4 graduations. */
function niceTicks(max: number, count = 4) {
  if (max <= 0) return { top: 1, ticks: [0, 1] };
  const raw = max / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const top = step * count;
  return { top, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) };
}

/** Largeur d'un conteneur (ResizeObserver) pour dessiner en pixels réels. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => setW(Math.round(entries[0].contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Tooltip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`pointer-events-none absolute z-20 whitespace-nowrap rounded-xl border border-line surface px-3 py-2 text-xs shadow-lift ${className}`} role="tooltip">{children}</div>;
}

// ------------------------------------------------------------------ Carte de graphique avec vue tableau
export function ChartCard({ title, subtitle, children, table, action, className = "" }: { title: string; subtitle?: string; children: ReactNode; table?: { head: string[]; rows: (string | number)[][] }; action?: ReactNode; className?: string }) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className={`card min-w-0 p-4 sm:p-5 ${className}`}>
      <header className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0"><h3 className="text-sm font-extrabold tracking-tight">{title}</h3>{subtitle ? <p className="text-xs text-muted">{subtitle}</p> : null}</div>
        <div className="flex shrink-0 items-center gap-1">{action}{table ? <button onClick={() => setShowTable(!showTable)} className="touch flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:surface-2" title={showTable ? "Voir le graphique" : "Voir les valeurs"} aria-label={showTable ? "Voir le graphique" : "Voir les valeurs"}>{showTable ? <BarChart3 className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}</button> : null}</div>
      </header>
      {showTable && table ? (
        <div className="max-h-72 overflow-auto rounded-xl border border-line">
          <table className="w-full text-xs"><thead className="sticky top-0 surface-2 text-[10px] uppercase tracking-wider text-muted"><tr>{table.head.map((h, i) => <th key={i} className={`px-3 py-2 font-bold ${i ? "text-right" : "text-left"}`}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className={`px-3 py-1.5 ${j ? "text-right tabular-nums" : "font-semibold"}`}>{c}</td>)}</tr>)}</tbody></table>
        </div>
      ) : children}
    </section>
  );
}

// ------------------------------------------------------------------ Figures
export function Delta({ value, suffix = "vs J-7", upIsGood = true, light = false }: { value: number | null | undefined; suffix?: string; upIsGood?: boolean; light?: boolean }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const good = up === upIsGood;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const tone = light ? (good ? "bg-white/20 text-white" : "bg-black/20 text-white") : good ? "bg-[var(--viz-good)]/12 text-[var(--viz-good)]" : "bg-[var(--viz-bad)]/12 text-[var(--viz-bad)]";
  return <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}><Icon className="h-3 w-3" />{up ? "+" : ""}{value.toFixed(1)} %<span className="ml-1 font-medium opacity-80">{suffix}</span></span>;
}

/** Tuile statistique : icône teintée, libellé, valeur en chiffres proportionnels, écart ou indication. */
export function Stat({ label, value, delta, hint, accent = "#14aaa3", icon, upIsGood = true }: { label: string; value: ReactNode; delta?: number | null; hint?: string; accent?: string; icon?: ReactNode; upIsGood?: boolean }) {
  return (
    <div className="card relative overflow-hidden p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</p>
        {icon ? <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>{icon}</span> : <span className="mt-1 h-2 w-2 rounded-full" style={{ background: accent }} />}
      </div>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
      <div className="mt-1 min-h-5 text-xs text-muted">{delta !== undefined && delta !== null ? <Delta value={delta} upIsGood={upIsGood} /> : hint}</div>
    </div>
  );
}

/** Jauge : ratio contre des seuils ; la piste est une teinte claire de la même couleur, statut avec icône et libellé. */
export function Meter({ label, value, display, warn, bad, max = 100, hint }: { label: string; value: number | null; display?: string; warn: number; bad: number; max?: number; hint?: string }) {
  const status = value === null ? null : value >= bad ? "bad" : value >= warn ? "warn" : "good";
  const color = status === "bad" ? "var(--viz-bad)" : status === "warn" ? "var(--viz-warn)" : "var(--viz-good)";
  const statusLabel = status === "bad" ? "Élevé" : status === "warn" ? "À surveiller" : status === "good" ? "Bon" : "—";
  const pctW = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2"><span className="text-xs font-semibold">{label}</span><span className="text-sm font-extrabold tabular-nums">{display ?? (value === null ? "—" : `${value} %`)}</span></div>
      <div className="relative h-2.5 w-full overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${color} 18%, transparent)` }}>
        <div className="viz-bar h-full rounded-full" style={{ width: `${pctW}%`, background: color }} />
        <span className="absolute inset-y-0 w-px bg-[var(--surface)]" style={{ left: `${(warn / max) * 100}%` }} title={`Seuil ${warn} %`} />
        <span className="absolute inset-y-0 w-px bg-[var(--surface)]" style={{ left: `${(bad / max) * 100}%` }} title={`Seuil ${bad} %`} />
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted"><span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: color }} /><b style={{ color: status ? color : undefined }}>{statusLabel}</b>{hint ? <span>· {hint}</span> : null}</p>
    </div>
  );
}

// ------------------------------------------------------------------ Courbe / étincelle
export function Sparkline({ data, color = "currentColor", height = 44, highlight }: { data: number[]; color?: string; height?: number; highlight?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const n = data.length;
  const hi0 = Math.max(1, ...data), lo0 = Math.min(...data, hi0);
  const lo = Math.max(0, lo0 - (hi0 - lo0) * 0.35), span = Math.max(1, hi0 - lo); // échelle resserrée : l'amplitude reste lisible
  const pts = n > 1 && w > 0 ? data.map((v, i) => [4 + (i / (n - 1)) * (w - 8), 4 + (1 - (v - lo) / span) * (height - 12)] as const) : [];
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const hi = highlight ?? n - 1;
  return (
    <div ref={ref} className="w-full" style={{ height }}>
      {pts.length ? (
        <svg width={w} height={height} className="overflow-visible" aria-hidden="true">
          <path d={`${path} L${pts[pts.length - 1][0]} ${height - 4} L${pts[0][0]} ${height - 4} Z`} fill={color} opacity={0.1} />
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="viz-line" />
          {pts[hi] ? <circle cx={pts[hi][0]} cy={pts[hi][1]} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} /> : null}
        </svg>
      ) : null}
    </div>
  );
}

/** Courbe avec aire, réticule et info-bulle listant la valeur au point le plus proche. */
export function LineChart({ data, currency, height = 200, highlight, color = SERIES[0] }: { data: { label: string; value: number; sub?: string }[]; currency?: string; height?: number; highlight?: number; color?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = data.length;
  if (n === 0) return <p className="py-8 text-center text-sm text-muted">Aucune donnée</p>;
  const padL = 44, padR = 16, padT = 14, padB = 26;
  const plotW = Math.max(0, w - padL - padR), plotH = height - padT - padB;
  const { top, ticks } = niceTicks(Math.max(...data.map((d) => d.value)));
  const x = (i: number) => padL + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number) => padT + (1 - v / top) * plotH;
  const pts = data.map((d, i) => [x(i), y(d.value)] as const);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const maxI = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0);
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 44))));
  const shown = new Set<number>(); for (let i = 0; i < n; i += every) shown.add(i);
  if (!shown.has(n - 1)) { const last = Math.max(...shown); if (n - 1 - last < every) shown.delete(last); shown.add(n - 1); }
  const fmt = (v: number) => (currency ? formatMoney(v, currency) : v.toLocaleString("fr-FR"));
  const onMove = (e: React.PointerEvent) => { const rect = (e.currentTarget as SVGElement).getBoundingClientRect(); const px = e.clientX - rect.left; let best = 0; for (let i = 1; i < n; i++) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; setHover(best); };
  const hi = hover ?? highlight ?? n - 1;
  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {w > 0 ? (
        <svg width={w} height={height} onPointerMove={onMove} onPointerLeave={() => setHover(null)} className="touch-none overflow-visible" role="img" aria-label="Courbe">
          {ticks.map((t) => <g key={t}><line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} /><text x={padL - 8} y={y(t) + 3} textAnchor="end" fontSize={10} fill="var(--muted)" className="tabular-nums">{compact(t, currency)}</text></g>)}
          <path d={`${path} L${pts[n - 1][0]} ${y(0)} L${pts[0][0]} ${y(0)} Z`} fill={color} opacity={0.1} />
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" pathLength={1} className="viz-line" />
          {data.map((d, i) => shown.has(i) ? <text key={i} x={x(i)} y={height - 8} textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"} fontSize={10} fill="var(--muted)">{d.label}</text> : null)}
          {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1={padT} y2={y(0)} stroke="var(--viz-axis)" strokeWidth={1} /> : null}
          {maxI !== hi ? <text x={x(maxI)} y={y(data[maxI].value) - 9} textAnchor="middle" fontSize={10} fontWeight={700} fill="var(--text)">{compact(data[maxI].value, currency)}</text> : null}
          <circle cx={x(hi)} cy={y(data[hi].value)} r={5} fill={highlight === hi && hover === null ? "var(--viz-2)" : color} stroke="var(--surface)" strokeWidth={2} />
        </svg>
      ) : null}
      {hover !== null && w > 0 ? <Tooltip className={hover > n / 2 ? "-translate-x-full" : ""} ><div style={{ marginLeft: 0 }}><b className="text-sm">{fmt(data[hover].value)}</b><span className="ml-2 text-muted">{data[hover].label}</span>{data[hover].sub ? <span className="block text-muted">{data[hover].sub}</span> : null}</div></Tooltip> : null}
      {hover !== null && w > 0 ? <style>{`[role=tooltip]{left:${x(hover) + (hover > n / 2 ? -8 : 8)}px;top:${Math.max(0, y(data[hover].value) - 44)}px}`}</style> : null}
    </div>
  );
}

// ------------------------------------------------------------------ Colonnes
/** Colonnes fines (≤ 24 px), une couleur, pic mis en avant et libellé direct, survol par colonne. */
export function ColumnChart({ data, currency, height = 200, color = SERIES[0], valueLabel, emphasis = "max" }: { data: { label: string; value: number; sub?: string }[]; currency?: string; height?: number; color?: string; valueLabel?: (v: number) => string; emphasis?: "max" | "none" | number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, w] = useWidth<HTMLDivElement>();
  const n = data.length;
  if (n === 0) return <p className="py-8 text-center text-sm text-muted">Aucune donnée</p>;
  const { top, ticks } = niceTicks(Math.max(...data.map((d) => d.value)));
  const fmt = valueLabel ?? ((v: number) => (currency ? formatMoney(v, currency) : v.toLocaleString("fr-FR")));
  const maxI = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0);
  const hi = emphasis === "max" ? maxI : typeof emphasis === "number" ? emphasis : -1;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(Math.max(w - 40, 1) / 34))));
  const plotH = height - 24;
  return (
    <div ref={ref} className="w-full pt-4">
      <div className="relative" style={{ height: plotH }}>
        {ticks.map((t) => <div key={t} className="absolute inset-x-0 flex items-center" style={{ top: `${(1 - t / top) * 100}%` }}><span className="w-10 pr-2 text-right text-[10px] tabular-nums text-muted">{compact(t, currency)}</span><span className="h-px flex-1" style={{ background: "var(--viz-grid)" }} /></div>)}
        <div className="absolute inset-y-0 left-10 right-0 flex items-end gap-[2px]">
          {data.map((d, i) => {
            const h = Math.max(d.value > 0 ? 3 : 0, (d.value / top) * 100);
            const active = hover === i;
            return (
              <div key={i} className="group relative flex h-full min-w-0 flex-1 items-end justify-center" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
                <div className="viz-bar w-full max-w-6 rounded-t-[4px] transition-[filter,opacity] duration-150" style={{ height: `${h}%`, background: i === hi ? "var(--viz-2)" : color, opacity: hover !== null && !active ? 0.55 : 1, filter: active ? "brightness(1.08)" : undefined, animationDelay: `${i * 18}ms` }} />
                {i === hi && hover === null ? <span className="pointer-events-none absolute whitespace-nowrap text-[10px] font-bold tabular-nums" style={{ bottom: `calc(${h}% + 4px)` }}>{compact(d.value, currency)}</span> : null}
                {active ? <Tooltip className={`${i > n / 2 ? "right-0" : "left-0"} top-0`}><b className="text-sm">{fmt(d.value)}</b><span className="ml-2 text-muted">{d.label}</span>{d.sub ? <span className="block text-muted">{d.sub}</span> : null}</Tooltip> : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="ml-10 flex gap-[2px]">{data.map((d, i) => <div key={i} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[10px] text-muted">{i % every === 0 ? d.label : ""}</div>)}</div>
    </div>
  );
}

/** Compatibilité : ancien composant, mêmes propriétés. */
export function BarChart({ data, currency = "XPF", height = 180, color, valueLabel }: { data: { label: string; value: number; secondary?: number }[]; currency?: string; height?: number; color?: string; valueLabel?: (v: number) => string }) {
  return <ColumnChart data={data} currency={valueLabel ? undefined : currency} height={height} color={color ?? SERIES[0]} valueLabel={valueLabel} />;
}

// ------------------------------------------------------------------ Barres horizontales
export function HBars({ data, currency = "XPF", color = SERIES[0], valueLabel, max: maxProp }: { data: { label: string; value: number; hint?: string }[]; currency?: string; color?: string; valueLabel?: (v: number) => string; max?: number }) {
  const max = Math.max(1, maxProp ?? 0, ...data.map((d) => d.value));
  const fmt = valueLabel ?? ((v: number) => formatMoney(v, currency));
  if (data.length === 0) return <p className="py-6 text-center text-sm text-muted">Aucune donnée</p>;
  return (
    <div className="space-y-2.5">
      {data.map((d, i) => (
        <div key={i} className="group" title={`${d.label} : ${fmt(d.value)}`}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-xs"><span className="min-w-0 truncate font-semibold">{d.label}{d.hint ? <span className="ml-1.5 font-normal text-muted">{d.hint}</span> : null}</span><span className="shrink-0 font-bold tabular-nums">{fmt(d.value)}</span></div>
          <div className="h-2 w-full rounded-full" style={{ background: "var(--viz-grid)" }}><div className="viz-bar h-2 rounded-full transition group-hover:brightness-110" style={{ width: `${(d.value / max) * 100}%`, background: color, animationDelay: `${i * 30}ms` }} /></div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Part du tout
/** Barre empilée (parts d'un total) avec écarts de 2 px, légende et info-bulle par segment. */
export function StackedBar({ data, currency = "XPF", valueLabel }: { data: { label: string; value: number; hint?: string }[]; currency?: string; valueLabel?: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = data.reduce((a, d) => a + d.value, 0);
  const fmt = valueLabel ?? ((v: number) => formatMoney(v, currency));
  if (data.length === 0 || total <= 0) return <p className="py-6 text-center text-sm text-muted">Aucune donnée</p>;
  const shown = data.slice(0, SERIES.length - 1);
  const rest = data.slice(SERIES.length - 1);
  const rows = rest.length ? [...shown, { label: "Autres", value: rest.reduce((a, d) => a + d.value, 0), hint: `${rest.length} moyens` }] : shown;
  return (
    <div>
      <div className="relative flex h-4 w-full gap-[2px] overflow-visible">
        {rows.map((d, i) => (
          <div key={i} className="relative h-full min-w-[3px] transition-[filter,opacity] duration-150 first:rounded-l-full last:rounded-r-full" style={{ width: `${(d.value / total) * 100}%`, background: SERIES[i], opacity: hover !== null && hover !== i ? 0.5 : 1, filter: hover === i ? "brightness(1.08)" : undefined }} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            {hover === i ? <Tooltip className={`top-6 ${i > rows.length / 2 ? "right-0" : "left-0"}`}><b className="text-sm">{fmt(d.value)}</b><span className="ml-2 text-muted">{d.label} · {Math.round((d.value / total) * 100)} %</span></Tooltip> : null}
          </div>
        ))}
      </div>
      <ul className={`mt-3 grid gap-x-6 gap-y-1.5 ${rows.length > 3 ? "sm:grid-cols-2" : ""}`}>
        {rows.map((d, i) => (
          <li key={i} className="flex items-center gap-2 text-xs" onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIES[i] }} />
            <span className="min-w-0 flex-1 truncate font-semibold">{d.label}{d.hint ? <span className="ml-1 font-normal text-muted">{d.hint}</span> : null}</span>
            <span className="tabular-nums text-muted">{Math.round((d.value / total) * 100)} %</span>
            <span className="w-20 text-right font-bold tabular-nums">{fmt(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Classement (top produits) : rang, nom, quantité, valeur et barre proportionnelle. */
export function Ranking({ data, currency = "XPF" }: { data: { label: string; value: number; hint?: string }[]; currency?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <p className="py-6 text-center text-sm text-muted">Aucune donnée</p>;
  return (
    <ol className="space-y-1.5">
      {data.map((d, i) => (
        <li key={i} className="relative overflow-hidden rounded-xl px-3 py-2" title={`${d.label} : ${formatMoney(d.value, currency)}`}>
          <span className="viz-bar absolute inset-y-0 left-0 rounded-xl" style={{ width: `${(d.value / max) * 100}%`, background: "color-mix(in srgb, var(--viz-1) 12%, transparent)", animationDelay: `${i * 30}ms` }} />
          <span className="relative flex items-center gap-3 text-xs">
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${i < 3 ? "bg-brand text-white" : "surface-2 text-muted"}`}>{i + 1}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{d.label}{d.hint ? <span className="ml-1.5 font-normal text-muted">{d.hint}</span> : null}</span>
            <span className="shrink-0 font-bold tabular-nums">{formatMoney(d.value, currency)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
