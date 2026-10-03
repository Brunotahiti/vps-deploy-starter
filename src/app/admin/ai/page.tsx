"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, CalendarRange, ClipboardCheck, PackageCheck, Sparkles, TrendingDown, TrendingUp, Wand2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { PageHeader, useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { formatDateTime } from "@/lib/dates";
import type { ForecastDay, ForecastLevel } from "@/server/services/forecast";
import { LEVEL_LOOK } from "@/components/ai/levels";
import type { QualityIndicators, QualityReport } from "@/server/services/quality";
import type { WeekAdvice } from "@/server/services/ai-assistant";

type Forecast = { days: ForecastDay[]; reference: number; historyDays: number; trend: number };
type QualityData = { configured: boolean; indicators: { period: { days: number }; current: QualityIndicators; previous: QualityIndicators }; reports: { id: string; createdAt: string; model: string; report: QualityReport }[] };
type Purchase = { horizon: number; leadDays: number; activity: number; groups: { supplier: { id: string; name: string }; total: number; lines: { ingredientId: string; ingredient: string; unit: string; stockQty: number; dailyUse: number; daysLeft: number | null; product: string; packSize: number; packs: number; unitPrice: number; reason: string }[] }[] };

const dayLabel = (day: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`)).replace(/^./, (c) => c.toUpperCase()); // « Lun. 5 oct. »

/** Assistant IA : prévisions façon Bison Futé, analyse qualité inspirée de l'ISO 9001, commande d'achats proposée. */
export default function AiPage() {
  const [tab, setTab] = useState<"forecast" | "quality" | "purchase">("forecast");
  const tabs = [
    { key: "forecast" as const, label: "Prévisions", icon: CalendarRange },
    { key: "quality" as const, label: "Qualité", icon: ClipboardCheck },
    { key: "purchase" as const, label: "Commande proposée", icon: PackageCheck },
  ];
  return (
    <div>
      <PageHeader title="Assistant IA" subtitle="Anticiper la demande, améliorer la qualité, commander juste" />
      <div className="mb-5 flex gap-1 overflow-x-auto rounded-2xl surface-2 p-1" role="tablist">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`touch flex h-11 flex-1 shrink-0 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition ${tab === t.key ? "surface shadow-sm" : "text-muted"}`}><t.icon className="h-4 w-4" />{t.label}</button>
        ))}
      </div>
      {tab === "forecast" ? <ForecastTab /> : tab === "quality" ? <QualityTab /> : <PurchaseTab />}
    </div>
  );
}

function ForecastTab() {
  const act = useAction();
  const qc = useQueryClient();
  const f = useQuery({ queryKey: ["ai", "forecast"], queryFn: () => api.get<Forecast>("/api/ai/forecast?days=14") });
  const week = useQuery({ queryKey: ["ai", "week"], queryFn: () => api.get<{ createdAt: string; advice: WeekAdvice } | null>("/api/ai/week") });
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    await act(() => api.post("/api/ai/week"), { success: "Conseils de la semaine prêts" });
    await qc.invalidateQueries({ queryKey: ["ai", "week"] });
    setBusy(false);
  };
  if (f.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  const data = f.data;
  if (!data) return null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(Object.keys(LEVEL_LOOK) as ForecastLevel[]).map((l) => <span key={l} className={`rounded-full px-3 py-1 font-bold ${LEVEL_LOOK[l].soft} ${LEVEL_LOOK[l].text}`}>{LEVEL_LOOK[l].emoji} {LEVEL_LOOK[l].label}</span>)}
        <span className="ml-auto text-xs text-muted">Calculé sur {data.historyDays} journées · grosse journée ≈ {data.reference} clients{data.trend !== 1 ? ` · tendance ${data.trend > 1 ? "+" : ""}${Math.round((data.trend - 1) * 100)} %` : ""}</span>
      </div>
      {data.historyDays < 7 ? <p className="rounded-2xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">Encore peu d&apos;historique : les prévisions s&apos;affinent chaque jour avec vos ventes et vos réservations.</p> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7" data-testid="forecast-days">
        {data.days.map((d) => {
          const look = LEVEL_LOOK[d.level];
          return (
            <div key={d.day} className={`card overflow-hidden ${d.closed ? "opacity-50" : ""}`} data-level={d.closed ? "closed" : d.level}>
              <div className={`${d.closed ? "bg-slate-300 dark:bg-slate-700" : look.band} px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide text-white`}>{d.closed ? "Fermé d'habitude" : look.label}</div>
              <div className="p-3">
                <p className="text-sm font-bold">{dayLabel(d.day)}</p>
                {d.closed ? null : <>
                  <p className="mt-1 whitespace-nowrap text-3xl font-extrabold tabular-nums">≈ {d.expected.clients}</p>
                  <p className="text-[11px] font-semibold text-muted">clients · midi {d.expected.lunch} · soir {d.expected.dinner}</p>
                  {d.booked.covers ? <p className="mt-1.5 inline-block rounded-full bg-lagon-500/15 px-2 py-0.5 text-[11px] font-bold text-lagon-700 dark:text-lagon-300">{d.booked.covers} couverts réservés</p> : null}
                  <p className="mt-2 text-xs leading-snug text-muted">{d.advice}</p>
                  {d.confidence === "low" ? <p className="mt-1 text-[10px] text-muted">Prévision encore approximative</p> : null}
                </>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card overflow-hidden" data-testid="week-advice">
        <div className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-fuchsia-500 to-purple-700 px-5 py-4 text-white">
          <Sparkles className="h-6 w-6" />
          <div className="min-w-0 flex-1"><p className="text-lg font-extrabold">Conseils de la semaine</p><p className="text-sm opacity-90">L&apos;IA lit vos prévisions et vous propose quoi faire, jour par jour.</p></div>
          <Button variant="secondary" loading={busy} onClick={ask} className="bg-white! text-purple-700!"><Wand2 className="h-4 w-4" />{week.data ? "Mettre à jour" : "Demander à l'IA"}</Button>
        </div>
        {week.data ? (
          <div className="space-y-4 p-5">
            <p className="text-lg font-extrabold">{week.data.advice.titre}</p>
            <ul className="space-y-1.5">{week.data.advice.jours.map((j) => <li key={j.jour} className="flex gap-3 text-sm"><span className="w-24 shrink-0 font-bold">{dayLabel(j.jour)}</span><span>{j.conseil}</span></li>)}</ul>
            <div className="grid gap-3 sm:grid-cols-2">
              {([["👥 Équipe", week.data.advice.equipe], ["🔪 Mise en place", week.data.advice.miseEnPlace], ["🌿 Jours calmes", week.data.advice.joursCalmes], ["👀 Vigilance", week.data.advice.vigilance]] as const).filter(([, xs]) => xs.length).map(([t, xs]) => (
                <div key={t} className="rounded-2xl surface-2 p-3"><p className="mb-1 text-sm font-extrabold">{t}</p><ul className="list-disc space-y-0.5 pl-5 text-sm">{xs.map((x) => <li key={x}>{x}</li>)}</ul></div>
              ))}
            </div>
            <p className="text-[11px] text-muted">Rédigé le {formatDateTime(week.data.createdAt)}</p>
          </div>
        ) : <p className="p-5 text-sm text-muted">Pas encore de conseils : un appui sur « Demander à l&apos;IA » suffit.</p>}
      </div>
    </div>
  );
}

const pctDelta = (now: number | null, before: number | null) => (now === null || before === null || before === 0 ? null : Math.round(((now - before) / Math.abs(before)) * 100));

function Indicator({ label, now, before, format, goodWhenUp = true }: { label: string; now: number | null; before: number | null; format: (n: number) => React.ReactNode; goodWhenUp?: boolean }) {
  const d = pctDelta(now, before);
  const good = d === null || d === 0 ? null : (d > 0) === goodWhenUp;
  return (
    <div className="card px-4 py-3">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="text-xl font-extrabold tabular-nums">{now === null ? "—" : format(now)}</p>
      {d !== null && d !== 0 ? <p className={`flex items-center gap-1 text-[11px] font-bold ${good ? "text-green-600" : "text-red-600"}`}>{d > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{d > 0 ? "+" : ""}{d} % vs période précédente</p> : <p className="text-[11px] text-muted">stable</p>}
    </div>
  );
}

function QualityTab() {
  const act = useAction();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ai", "quality"], queryFn: () => api.get<QualityData>("/api/ai/quality") });
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  if (q.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!q.data) return null;
  const { indicators: ind, reports, configured } = q.data;
  const c = ind.current, p = ind.previous;
  const report = reports.find((r) => r.id === selected) ?? reports[0];
  const run = async () => {
    setBusy(true);
    const r = await act(() => api.post<{ id: string }>("/api/ai/quality"), { success: "Analyse qualité prête" });
    await qc.invalidateQueries({ queryKey: ["ai", "quality"] });
    if (r) setSelected(r.id);
    setBusy(false);
  };
  const pct = (n: number) => `${n} %`;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicator label={`Chiffre d'affaires (${ind.period.days} j)`} now={c.ventes.chiffreAffairesTTC} before={p.ventes.chiffreAffairesTTC} format={(n) => <Money amount={n} />} />
        <Indicator label="Panier moyen" now={c.ventes.panierMoyen} before={p.ventes.panierMoyen} format={(n) => <Money amount={n} />} />
        <Indicator label="Annulations (part du CA)" now={c.annulations.partDuCA} before={p.annulations.partDuCA} format={pct} goodWhenUp={false} />
        <Indicator label="Bons de plus de 20 min" now={c.cuisine.partPlusDe20Min} before={p.cuisine.partPlusDe20Min} format={pct} goodWhenUp={false} />
        <Indicator label="Temps moyen en cuisine" now={c.cuisine.tempsMoyenMin} before={p.cuisine.tempsMoyenMin} format={(n) => `${n} min`} goodWhenUp={false} />
        <Indicator label="Rappels de service en retard" now={c.service.partEnRetardDePlusDe5Min} before={p.service.partEnRetardDePlusDe5Min} format={pct} goodWhenUp={false} />
        <Indicator label="Absences aux réservations" now={c.reservations.tauxAbsence} before={p.reservations.tauxAbsence} format={pct} goodWhenUp={false} />
        <Indicator label="Clients qui reviennent" now={c.clients.tauxDeRetour} before={p.clients.tauxDeRetour} format={pct} />
      </div>

      <div className="card flex flex-wrap items-center gap-4 p-5">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-purple-700 text-white"><BrainCircuit className="h-6 w-6" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-extrabold">Analyse qualité, inspirée de l&apos;ISO 9001</p>
          <p className="text-sm text-muted">L&apos;IA lit ces chiffres, note chaque chapitre de la norme et vous propose un plan d&apos;actions. Comptez environ une minute.</p>
        </div>
        <Button size="lg" loading={busy} disabled={!configured} onClick={run} data-testid="run-quality"><Wand2 className="h-5 w-5" />{busy ? "L'IA rédige…" : "Lancer l'analyse"}</Button>
        {!configured ? <p className="w-full text-xs text-amber-700 dark:text-amber-300">L&apos;Assistant IA sera disponible dès que l&apos;équipe ManaResto aura branché la clé sur le serveur.</p> : null}
      </div>

      {report ? <QualityReportView report={report.report} createdAt={report.createdAt} /> : null}
      {reports.length > 1 ? (
        <div className="card p-4"><p className="mb-2 text-sm font-extrabold">Analyses précédentes</p>
          <div className="flex flex-wrap gap-2">{reports.map((r) => <button key={r.id} onClick={() => setSelected(r.id)} className={`touch rounded-xl px-3 py-2 text-xs font-bold ${r.id === report?.id ? "bg-brand text-white" : "surface-2"}`}>{formatDateTime(r.createdAt)} · {r.report.score}/100</button>)}</div>
        </div>
      ) : null}
    </div>
  );
}

const PRIORITY = { haute: "bg-red-500/15 text-red-700 dark:text-red-300", moyenne: "bg-amber-500/15 text-amber-700 dark:text-amber-300", basse: "bg-slate-500/15 text-slate-600 dark:text-slate-300" };
const GRAVITY = { majeur: "bg-red-600 text-white", mineur: "bg-amber-500 text-white", "à surveiller": "bg-slate-500 text-white" };

function QualityReportView({ report, createdAt }: { report: QualityReport; createdAt: string }) {
  const color = report.score >= 75 ? "#22c55e" : report.score >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div className="space-y-4" data-testid="quality-report">
      <div className="card flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
        <div className="relative mx-auto h-28 w-28 shrink-0 rounded-full" style={{ background: `conic-gradient(${color} ${report.score * 3.6}deg, var(--surface-2) 0deg)` }}>
          <div className="absolute inset-2.5 flex flex-col items-center justify-center rounded-full surface"><span className="text-3xl font-extrabold tabular-nums">{report.score}</span><span className="text-[10px] font-bold text-muted">sur 100</span></div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base leading-relaxed">{report.resume}</p>
          {report.pointsForts.length ? <div className="mt-3 flex flex-wrap gap-1.5">{report.pointsForts.map((x) => <span key={x} className="rounded-full bg-green-500/15 px-3 py-1 text-xs font-bold text-green-700 dark:text-green-300">✓ {x}</span>)}</div> : null}
        </div>
      </div>
      <div className="card p-5">
        <p className="mb-3 text-sm font-extrabold">Les 7 chapitres de la norme</p>
        <div className="space-y-3">{report.chapitres.map((ch) => (
          <div key={ch.chapitre} className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
            <div className="flex w-full shrink-0 items-center justify-between sm:w-72"><span className="text-sm font-bold">{ch.chapitre}</span><span className="flex gap-1" aria-label={`Maturité ${ch.maturite} sur 5`}>{[1, 2, 3, 4, 5].map((i) => <span key={i} className={`h-2.5 w-5 rounded-full ${i <= ch.maturite ? "bg-purple-600" : "surface-3"}`} />)}</span></div>
            <p className="text-sm text-muted">{ch.constat}</p>
          </div>
        ))}</div>
      </div>
      {report.ecarts.length ? (
        <div className="card p-5"><p className="mb-3 text-sm font-extrabold">Écarts relevés</p>
          <div className="space-y-2">{report.ecarts.map((e) => <div key={e.titre} className="flex flex-wrap items-start gap-2 rounded-2xl surface-2 p-3"><span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${GRAVITY[e.gravite]}`}>{e.gravite}</span><div className="min-w-0 flex-1"><p className="text-sm font-bold">{e.titre}</p><p className="text-xs text-muted">{e.preuve}</p></div></div>)}</div>
        </div>
      ) : null}
      <div className="card p-5"><p className="mb-3 text-sm font-extrabold">🎯 Plan d&apos;actions</p>
        <div className="grid gap-3 md:grid-cols-2">{report.actions.map((a) => (
          <div key={a.action} className="rounded-2xl border border-line p-4">
            <div className="mb-1 flex items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[11px] font-extrabold ${PRIORITY[a.priorite]}`}>priorité {a.priorite}</span><span className="text-[11px] font-semibold text-muted">{a.responsable} · {a.delai}</span></div>
            <p className="font-bold">{a.action}</p>
            <p className="mt-1 text-sm text-muted">{a.pourquoi}</p>
            <p className="mt-2 text-xs"><b>À suivre :</b> {a.indicateur}</p>
          </div>
        ))}</div>
        <p className="mt-4 text-sm"><b>Prochaine revue :</b> {report.prochaineRevue}</p>
      </div>
      <p className="text-[11px] text-muted">Analyse rédigée le {formatDateTime(createdAt)} par l&apos;IA à partir des chiffres de ManaResto. Elle s&apos;inspire de la norme ISO 9001 et ne vaut pas certification.</p>
    </div>
  );
}

function PurchaseTab() {
  const { hasOption, can } = useSession();
  const act = useAction();
  const qc = useQueryClient();
  const stock = hasOption("stock");
  const q = useQuery({ queryKey: ["ai", "purchase"], queryFn: () => api.get<Purchase>("/api/ai/purchase"), enabled: stock });
  const [done, setDone] = useState<string[]>([]);
  if (!stock) return <div className="card p-6 text-center"><p className="text-lg font-extrabold">Commande proposée</p><p className="mt-1 text-sm text-muted">Elle s&apos;appuie sur vos recettes et votre stock : débloquez l&apos;option « Stock et recettes » pour l&apos;utiliser.</p><Link href="/admin/options" className="mt-3 inline-block font-bold text-lagon-700 underline">Voir les options</Link></div>;
  if (q.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (!q.data) return null;
  const create = async (supplierIds?: string[]) => {
    const r = await act(() => api.post<{ id: string; number: string }[]>("/api/ai/purchase", { supplierIds }), { success: "Bons de commande créés en brouillon", invalidate: [["stock"]] });
    if (r) { setDone((d) => [...d, ...(supplierIds ?? q.data!.groups.map((g) => g.supplier.id))]); qc.invalidateQueries({ queryKey: ["ai", "purchase"] }); }
  };
  const act100 = Math.round((q.data.activity - 1) * 100);
  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3 p-4">
        <PackageCheck className="h-6 w-6 text-lagon-600" />
        <p className="min-w-0 flex-1 text-sm">Calculé sur votre consommation des 4 dernières semaines, pour {q.data.horizon} jours + {q.data.leadDays} jours de livraison. Activité prévue : <b>{act100 === 0 ? "comme d'habitude" : `${act100 > 0 ? "+" : ""}${act100} %`}</b>.</p>
        {q.data.groups.length > 1 && can("stock.manage") ? <Button onClick={() => create()}>Tout préparer en brouillon</Button> : null}
      </div>
      {!q.data.groups.length ? <div className="card p-8 text-center"><p className="text-4xl">🎉</p><p className="mt-2 text-lg font-extrabold">Rien à commander</p><p className="text-sm text-muted">Votre stock couvre les jours à venir.</p></div> : null}
      {q.data.groups.map((g) => (
        <div key={g.supplier.id} className="card overflow-hidden" data-testid="purchase-group">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
            <p className="min-w-0 flex-1 text-base font-extrabold">{g.supplier.name}</p>
            <span className="font-extrabold"><Money amount={g.total} /></span>
            {can("stock.manage") ? (done.includes(g.supplier.id) ? <Link href="/admin/stock/orders" className="text-sm font-bold text-green-700 underline">✓ Brouillon créé</Link> : <Button size="sm" onClick={() => create([g.supplier.id])}>Préparer le bon</Button>) : null}
          </div>
          <ul className="divide-y divide-[var(--border)]">{g.lines.map((l) => (
            <li key={l.ingredientId} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
              <span className={`w-28 shrink-0 rounded-full px-2 py-0.5 text-center text-[11px] font-extrabold ${l.daysLeft !== null && l.daysLeft <= 1 ? "bg-red-500/15 text-red-700 dark:text-red-300" : l.daysLeft !== null && l.daysLeft <= 3 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "surface-2 text-muted"}`}>{l.daysLeft === null ? "sous le seuil" : l.daysLeft <= 0 ? "épuisé" : `${l.daysLeft} j de stock`}</span>
              <span className="min-w-0 flex-1"><b>{l.ingredient}</b> <span className="text-muted">· {l.reason}</span></span>
              <span className="font-bold">{l.packs} × {l.product}</span>
              <span className="w-24 text-right"><Money amount={l.packs * l.unitPrice} /></span>
            </li>
          ))}</ul>
        </div>
      ))}
      <p className="text-[11px] text-muted">Les bons sont créés en brouillon : vous les relisez et les envoyez depuis Stocks &amp; achats.</p>
    </div>
  );
}
