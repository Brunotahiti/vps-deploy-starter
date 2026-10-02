"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Receipt, Users, ShoppingBag, UtensilsCrossed, ChevronLeft, ChevronRight, Percent, BadgeMinus, Ban, TrendingUp, TrendingDown } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { formatMoney } from "@/lib/money";
import { addDays, localDay } from "@/lib/dates";
import { Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { PageHeader } from "./common";
import { LiveDemoCard } from "@/components/demo-visit";
import { DayGoal, GettingStarted, greeting } from "./fun";
import { ChartCard, ColumnChart, LineChart, HBars, StackedBar, Ranking, Stat, Delta, Meter, Sparkline, compact } from "./charts";
import type { DailySummary } from "@/components/pos/types";
import { PAYMENT_LABEL } from "@/components/pos/types";

type RangeDay = { day: string; revenue: number; tickets: number; covers: number };
type Overview = { establishment: { id: string; name: string; city: string | null; currency: string }; revenue: number; tickets: number; covers: number; openOrders: number; previousRevenue: number }[];
type StaffSummary = { totalCost: number; totalHours: number; laborCostPct: number | null };

const longDate = (day: string) => new Date(day + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const shortDay = (day: string) => new Date(day + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
/** Plage horaire continue (au moins 10 h → 22 h) pour que les colonnes se répartissent sur la journée. */
function hoursRange(byHour: { hour: number; revenue: number; tickets: number }[]) {
  const first = Math.min(10, ...byHour.map((h) => h.hour)), last = Math.max(22, ...byHour.map((h) => h.hour));
  const map = new Map(byHour.map((h) => [h.hour, h]));
  return Array.from({ length: last - first + 1 }, (_, i) => map.get(first + i) ?? { hour: first + i, revenue: 0, tickets: 0 });
}

/** Tableau de bord du jour : chiffre phare, indicateurs, rentabilité, courbes et répartitions. */
export function Dashboard() {
  const { me, can, currency, timezone } = useSession();
  const today = localDay(new Date(), timezone);
  const [day, setDay] = useState(today);
  const allowed = can("reports.view");
  const daily = useQuery({ queryKey: ["reports", "daily", day], queryFn: () => api.get<DailySummary>(`/api/reports/daily?day=${day}`), refetchInterval: 60_000, enabled: allowed, placeholderData: (prev) => prev });
  const range = useQuery({ queryKey: ["reports", "range", day], queryFn: () => api.get<RangeDay[]>(`/api/reports/range?from=${addDays(day, -13)}&to=${day}`), enabled: allowed, placeholderData: (prev) => prev });
  // Objectif du jour : les 4 semaines précédentes (moyenne des mêmes jours de la semaine)
  const month = useQuery({ queryKey: ["reports", "range", "goal", day], queryFn: () => api.get<RangeDay[]>(`/api/reports/range?from=${addDays(day, -28)}&to=${addDays(day, -1)}`), enabled: allowed && day === today });
  const overview = useQuery({ queryKey: ["reports", "overview", day], queryFn: () => api.get<Overview>(`/api/reports/overview?day=${day}`), enabled: can("reports.view_global") && (me?.establishments?.length ?? 0) > 1 });
  const staff = useQuery({ queryKey: ["staff", "summary", day], queryFn: () => api.get<StaffSummary>(`/api/staff/summary?from=${day}&to=${day}`), enabled: allowed && can("staff.manage") });
  const d = daily.data;
  const days = range.data ?? [];
  const isToday = day === today;
  const stale = daily.isFetching && !daily.isLoading;

  const dateNav = (
    <div className="flex items-center gap-1.5">
      <button onClick={() => setDay(addDays(day, -1))} className="touch flex h-10 w-10 items-center justify-center rounded-xl surface-2" aria-label="Jour précédent"><ChevronLeft className="h-4 w-4" /></button>
      <label className="relative flex h-10 items-center rounded-xl border border-line surface px-3 text-sm font-semibold capitalize"><span>{shortDay(day)}</span><input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Choisir une date" /></label>
      <button onClick={() => setDay(addDays(day, 1))} disabled={isToday} className="touch flex h-10 w-10 items-center justify-center rounded-xl surface-2 disabled:opacity-40" aria-label="Jour suivant"><ChevronRight className="h-4 w-4" /></button>
      {!isToday ? <button onClick={() => setDay(today)} className="touch h-10 rounded-xl px-3 text-sm font-bold text-lagon-600">Aujourd&apos;hui</button> : null}
    </div>
  );

  const hello = greeting(me?.user?.firstName, timezone);
  if (!allowed) return <div><PageHeader title={hello.title} subtitle={me?.establishment?.name} /><p className="card p-6 text-sm text-muted">Ce compte n&apos;a pas accès aux rapports. Utilisez le menu pour rejoindre les écrans qui vous sont ouverts.</p></div>;
  return (
    <div>
      <PageHeader title={hello.title} subtitle={`${me?.establishment?.name ?? ""} · ${hello.mood}`} action={dateNav} />
      <LiveDemoCard />
      {me?.establishment ? <GettingStarted establishmentId={me.establishment.id} /> : null}
      {daily.isLoading || !d ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <div className={`space-y-4 transition-opacity duration-300 ${stale ? "opacity-60" : ""}`}>
          {/* ---- Chiffre phare + en direct */}
          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
            <section className="bg-lagoon relative overflow-hidden rounded-3xl p-5 text-white shadow-lift sm:p-6">
              <span className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
              <span className="pointer-events-none absolute -bottom-24 left-1/3 h-56 w-56 rounded-full bg-corail-400/25 blur-3xl" />
              <div className="relative">
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/80">Chiffre d&apos;affaires · <span className="normal-case">{longDate(day)}</span></p>
                <p className="mt-2 text-[44px] font-extrabold leading-none tracking-tight sm:text-[52px]">{formatMoney(d.revenue, currency)}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <Delta value={d.previous ? pct(d.revenue, d.previous.revenue) : null} light />
                  <span className="text-white/85">HT {formatMoney(d.revenueHt, currency)} · TVA {formatMoney(d.tax, currency)}</span>
                </div>
                {isToday && month.data ? <DayGoal day={day} revenue={d.revenue} history={month.data} currency={currency} /> : null}
                <div className="mt-5">
                  <p className="mb-1 flex items-center justify-between text-[11px] font-semibold text-white/75"><span>14 derniers jours</span><span>{days.length ? `max ${compact(Math.max(...days.map((x) => x.revenue)), currency)}` : ""}</span></p>
                  <Sparkline data={days.map((x) => x.revenue)} color="#ffffff" height={48} />
                </div>
              </div>
            </section>
            <section className="card flex flex-col justify-between p-5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted">{isToday ? "En ce moment" : "Fin de journée"}</p>
                {isToday ? <span className="flex items-center gap-2 text-[11px] font-bold text-lagon-600"><span className="live-dot relative inline-block h-2 w-2 rounded-full bg-lagon-500" />EN DIRECT</span> : null}
              </div>
              <div className="mt-2 flex items-end gap-3"><p className="text-5xl font-extrabold leading-none tracking-tight">{d.openOrders}</p><p className="pb-1 text-sm text-muted">commande{d.openOrders > 1 ? "s" : ""} en cours</p></div>
              <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-4 text-center">
                <div><dt className="text-[10px] font-bold uppercase tracking-wider text-muted">Tickets</dt><dd className="text-lg font-extrabold">{d.tickets}</dd></div>
                <div><dt className="text-[10px] font-bold uppercase tracking-wider text-muted">Couverts</dt><dd className="text-lg font-extrabold">{d.covers}</dd></div>
                <div><dt className="text-[10px] font-bold uppercase tracking-wider text-muted">J-7</dt><dd className="text-lg font-extrabold">{d.previous ? compact(d.previous.revenue, currency) : "—"}</dd></div>
              </dl>
            </section>
          </div>

          {/* ---- Indicateurs */}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label="Tickets" value={d.tickets} delta={d.previous ? pct(d.tickets, d.previous.tickets) : null} accent="#2a78d6" icon={<Receipt className="h-4 w-4" />} />
            <Stat label="Couverts" value={d.covers} delta={d.previous ? pct(d.covers, d.previous.covers) : null} accent="#f97c3c" icon={<Users className="h-4 w-4" />} />
            <Stat label="Panier moyen" value={<Money amount={d.avgTicket} />} hint="par ticket" accent="#4a3aa7" icon={<ShoppingBag className="h-4 w-4" />} />
            <Stat label="CA par couvert" value={<Money amount={d.avgPerCover} />} hint="TTC" accent="#14aaa3" icon={<UtensilsCrossed className="h-4 w-4" />} />
          </div>

          {/* ---- Rentabilité */}
          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            <ChartCard title="Rentabilité" subtitle="Ratios du jour sur le CA HT, seuils usuels de la restauration">
              <div className="grid gap-4 sm:grid-cols-2">
                <Meter label="Ratio coût matière" value={d.foodCostPct} warn={32} bad={38} max={60} hint={`matière ${formatMoney(d.foodCost, currency)}`} />
                {staff.data ? <Meter label="Coût du personnel" value={staff.data.laborCostPct} warn={30} bad={36} max={60} hint={`${staff.data.totalHours} h · ${formatMoney(staff.data.totalCost, currency)}`} /> : <Meter label="Coût du personnel" value={null} warn={30} bad={36} max={60} hint="pointages non disponibles" />}
                {staff.data ? <Meter label="Matière + personnel" value={d.foodCostPct !== null && staff.data.laborCostPct !== null ? Math.round((d.foodCostPct + staff.data.laborCostPct) * 10) / 10 : null} warn={60} bad={68} max={100} hint="matière + personnel" /> : null}
                {staff.data ? <div><p className="mb-1 text-xs font-semibold">Marge après matière et personnel</p><p className="text-2xl font-extrabold tracking-tight">{formatMoney(d.revenueHt - d.foodCost - staff.data.totalCost, currency)}</p><p className="text-[11px] text-muted">CA HT − matière − personnel</p></div> : null}
              </div>
            </ChartCard>
            <ChartCard title="À surveiller" subtitle="Remises, annulations et coût matière du jour">
              <ul className="divide-y divide-line">
                {[
                  { icon: <Percent className="h-4 w-4" />, label: "Remises accordées", value: formatMoney(d.discounts, currency), tone: "#4a3aa7" },
                  { icon: <Ban className="h-4 w-4" />, label: "Annulations", value: `${d.cancellations}`, tone: "#dc2626" },
                  { icon: <BadgeMinus className="h-4 w-4" />, label: "Coût matière estimé", value: formatMoney(d.foodCost, currency), tone: "#f97c3c" },
                ].map((r) => (
                  <li key={r.label} className="flex items-center gap-3 py-2.5 text-sm"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${r.tone} 14%, transparent)`, color: r.tone }}>{r.icon}</span><span className="flex-1 font-semibold">{r.label}</span><span className="font-extrabold tabular-nums">{r.value}</span></li>
                ))}
              </ul>
            </ChartCard>
          </div>

          {/* ---- Rentabilité par plat */}
          <ChartCard title="Plats les plus et les moins rentables" subtitle="Marge brute HT du jour (prix HT − coût matière), produits dont le coût est renseigné" table={{ head: ["Plat", "Marge %", "Marge", "CA HT", "Coût", "Qté"], rows: [...d.profitability.best, ...d.profitability.worst].map((p) => [p.name, p.marginPct !== null ? `${p.marginPct} %` : "—", formatMoney(p.margin, currency), formatMoney(p.revenueHt, currency), formatMoney(p.cost, currency), p.quantity]) }}>
            {d.profitability.best.length === 0 ? <p className="py-6 text-center text-sm text-muted">Renseignez le coût des produits (fiche produit ou recette) pour voir leur rentabilité.</p> : (
              <div className="grid gap-5 lg:grid-cols-2">
                <ProfitList title="Les plus rentables" icon={<TrendingUp className="h-4 w-4" />} tone="var(--viz-good)" rows={d.profitability.best} currency={currency} />
                <ProfitList title="Les moins rentables" icon={<TrendingDown className="h-4 w-4" />} tone="var(--viz-bad)" rows={d.profitability.worst} currency={currency} />
              </div>
            )}
            {d.profitability.unknownCost > 0 ? <p className="mt-3 text-[11px] text-muted">{d.profitability.unknownCost} produit{d.profitability.unknownCost > 1 ? "s" : ""} vendu{d.profitability.unknownCost > 1 ? "s" : ""} sans coût matière renseigné, non classé{d.profitability.unknownCost > 1 ? "s" : ""}.</p> : null}
          </ChartCard>

          {/* ---- Établissements */}
          {overview.data && overview.data.length > 1 ? (
            <ChartCard title="Tous les établissements" subtitle="Chiffre d'affaires du jour par site" table={{ head: ["Établissement", "CA", "Tickets", "Couverts", "En cours"], rows: overview.data.map((r) => [r.establishment.name, formatMoney(r.revenue, r.establishment.currency), r.tickets, r.covers, r.openOrders]) }}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {overview.data.map((r) => (
                  <div key={r.establishment.id} className="rounded-2xl surface-2 p-3"><p className="text-sm font-bold">{r.establishment.name}<span className="ml-1 text-xs font-normal text-muted">{r.establishment.city ?? ""}</span></p><p className="mt-1 text-xl font-extrabold tracking-tight">{formatMoney(r.revenue, r.establishment.currency)}</p><div className="mt-1 flex items-center gap-2 text-xs text-muted"><Delta value={pct(r.revenue, r.previousRevenue)} /><span>{r.tickets} tickets · {r.covers} couv.</span></div></div>
                ))}
              </div>
            </ChartCard>
          ) : null}

          {/* ---- Graphiques */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Chiffre d'affaires par heure" subtitle="Heure de clôture des tickets" table={{ head: ["Heure", "CA", "Tickets"], rows: d.byHour.map((h) => [`${h.hour} h`, formatMoney(h.revenue, currency), h.tickets]) }}>
              <ColumnChart data={hoursRange(d.byHour).map((h) => ({ label: `${h.hour}h`, value: h.revenue, sub: `${h.tickets} ticket${h.tickets > 1 ? "s" : ""}` }))} currency={currency} />
            </ChartCard>
            <ChartCard title="14 derniers jours" subtitle="Chiffre d'affaires quotidien, jour sélectionné en orange" table={{ head: ["Jour", "CA", "Tickets", "Couverts"], rows: days.map((x) => [shortDay(x.day), formatMoney(x.revenue, currency), x.tickets, x.covers]) }}>
              <LineChart data={days.map((x) => ({ label: x.day.slice(8) + "/" + x.day.slice(5, 7), value: x.revenue, sub: `${x.tickets} tickets · ${x.covers} couverts` }))} currency={currency} highlight={Math.max(0, days.findIndex((x) => x.day === day))} />
            </ChartCard>
            <ChartCard title="Par catégorie" subtitle="Chiffre d'affaires TTC" table={{ head: ["Catégorie", "CA", "Quantité"], rows: d.byCategory.map((c) => [c.name, formatMoney(c.revenue, currency), c.quantity]) }}>
              <HBars data={d.byCategory.map((c) => ({ label: c.name, value: c.revenue, hint: `× ${c.quantity}` }))} currency={currency} />
            </ChartCard>
            <ChartCard title="Moyens de paiement" subtitle="Part de chaque moyen dans les encaissements" table={{ head: ["Moyen", "Montant", "Paiements"], rows: d.byMethod.map((m) => [PAYMENT_LABEL[m.method] ?? m.method, formatMoney(m.amount, currency), m.count]) }}>
              <StackedBar data={d.byMethod.map((m) => ({ label: PAYMENT_LABEL[m.method] ?? m.method, value: m.amount, hint: `× ${m.count}` }))} currency={currency} />
            </ChartCard>
            <ChartCard title="Par serveur" subtitle="Chiffre d'affaires encaissé" table={{ head: ["Serveur", "CA", "Tickets"], rows: d.byServer.map((s) => [s.name, formatMoney(s.revenue, currency), s.tickets]) }}>
              <HBars data={d.byServer.map((s) => ({ label: s.name, value: s.revenue, hint: `${s.tickets} ticket${s.tickets > 1 ? "s" : ""}` }))} currency={currency} color="var(--viz-6)" />
            </ChartCard>
            <ChartCard title="Top produits" subtitle="Les 10 meilleures ventes du jour" table={{ head: ["Produit", "CA", "Quantité"], rows: d.byProduct.slice(0, 10).map((p) => [p.name, formatMoney(p.revenue, currency), p.quantity]) }}>
              <Ranking data={d.byProduct.slice(0, 10).map((p) => ({ label: p.name, value: p.revenue, hint: `× ${p.quantity}` }))} currency={currency} />
            </ChartCard>
          </div>
        </div>
      )}
    </div>
  );
}

/** Liste de plats avec marge en % (barre sur 100 %), marge en F et quantité vendue. */
function ProfitList({ title, icon, tone, rows, currency }: { title: string; icon: React.ReactNode; tone: string; rows: DailySummary["byProduct"]; currency: string }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-xs font-extrabold"><span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${tone} 14%, transparent)`, color: tone }}>{icon}</span>{title}</p>
      {rows.length === 0 ? <p className="text-xs text-muted">Aucun plat à afficher.</p> : (
        <ul className="space-y-2.5">
          {rows.map((p, i) => (
            <li key={p.name} className="text-xs">
              <div className="mb-1 flex items-baseline justify-between gap-3"><span className="min-w-0 truncate font-semibold">{p.name}<span className="ml-1.5 font-normal text-muted">× {p.quantity}</span></span><span className="shrink-0 tabular-nums"><b>{p.marginPct} %</b><span className="ml-1.5 text-muted">{formatMoney(p.margin, currency)}</span></span></div>
              <div className="h-2 w-full rounded-full" style={{ background: "var(--viz-grid)" }}><div className="viz-bar h-2 rounded-full" style={{ width: `${Math.max(0, Math.min(100, p.marginPct ?? 0))}%`, background: tone, animationDelay: `${i * 30}ms` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
