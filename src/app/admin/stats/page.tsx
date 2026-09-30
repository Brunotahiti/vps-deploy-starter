"use client";

import { useState } from "react";
import { Sparkles, AlertTriangle, Info, TrendingUp, Receipt, Users, ShoppingBag, ChefHat, CalendarDays, Heart, Percent } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { formatMoney } from "@/lib/money";
import { addDays, localDay } from "@/lib/dates";
import { PageHeader, Table, Tr, Td, useList } from "@/components/admin/common";
import { Stat, Meter, ChartCard, LineChart, ColumnChart, HBars, StackedBar, Ranking, Delta } from "@/components/admin/charts";
import { PAYMENT_LABEL, ORDER_TYPE_LABEL } from "@/components/pos/types";
import type { Stats } from "@/server/services/stats";

const PRESETS: [string, (t: string) => [string, string]][] = [
  ["7 jours", (t) => [addDays(t, -6), t]], ["30 jours", (t) => [addDays(t, -29), t]],
  ["Ce mois", (t) => [t.slice(0, 8) + "01", t]], ["Mois dernier", (t) => { const first = t.slice(0, 8) + "01"; const lastPrev = addDays(first, -1); return [lastPrev.slice(0, 8) + "01", lastPrev]; }],
  ["90 jours", (t) => [addDays(t, -89), t]],
];
const pct = (a: number, b: number | undefined | null) => (b ? ((a - b) / b) * 100 : null);
const min = (sec: number | null) => (sec === null ? "—" : `${Math.round(sec / 60)} min`);
const fmtDay = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });

/** Statistiques complètes : faits marquants, indicateurs clés avec comparaison, tendances, produits, équipe, cuisine, réservations, clients. */
export default function StatsPage() {
  const { currency, timezone } = useSession();
  const today = localDay(new Date(), timezone);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const [preset, setPreset] = useState("30 jours");
  const r = useList<Stats>(["stats", from, to], `/api/stats?from=${from}&to=${to}`);
  const s = r.data;
  const p = s?.period;
  const prevLabel = p?.previous ? `vs ${fmtDay(p.previous.from)} → ${fmtDay(p.previous.to)}` : "";
  return (
    <div>
      <PageHeader title="Statistiques" subtitle={p ? `${p.days} jour${p.days > 1 ? "s" : ""} · ${fmtDay(p.from)} → ${fmtDay(p.to)}${p.previous ? ` · comparé à la période précédente` : ""}` : "Choisissez une période"} action={
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map(([label, fn]) => <button key={label} onClick={() => { const [f, t] = fn(today); setFrom(f); setTo(t); setPreset(label); }} className={`touch h-10 rounded-lg px-3 text-xs font-bold ${preset === label ? "bg-brand text-white" : "surface-2"}`}>{label}</button>)}
          <Input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPreset(""); }} className="w-40!" aria-label="Du" /><span className="text-muted">→</span><Input type="date" value={to} max={today} onChange={(e) => { setTo(e.target.value); setPreset(""); }} className="w-40!" aria-label="Au" />
        </div>
      } />
      {r.isLoading || !s || !p ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <div className="space-y-4">
          {/* Bandeau : CA et faits marquants */}
          <section className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <div className="relative overflow-hidden rounded-2xl bg-lagoon p-5 text-white shadow-glow sm:p-6">
              <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
              <p className="text-xs font-bold uppercase tracking-wider text-white/80">Chiffre d&apos;affaires TTC</p>
              <p className="mt-1 text-4xl font-extrabold tracking-tight sm:text-5xl" data-testid="stats-revenue"><Money amount={p.revenue} /></p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-white/90"><Delta value={pct(p.revenue, p.previous?.revenue)} suffix={prevLabel} light /><span>· {formatMoney(p.days ? Math.round(p.revenue / p.days) : 0, currency)} par jour</span></div>
              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[["Tickets", p.tickets, pct(p.tickets, p.previous?.tickets)], ["Couverts", p.covers, pct(p.covers, p.previous?.covers)], ["Panier moyen", formatMoney(p.avgTicket, currency), pct(p.avgTicket, p.previous?.avgTicket)], ["Par couvert", formatMoney(p.avgPerCover, currency), null]].map(([l, v, d]) => (
                  <div key={String(l)} className="rounded-xl bg-white/12 p-3 backdrop-blur"><p className="text-[11px] font-bold uppercase tracking-wider text-white/75">{l}</p><p className="text-xl font-extrabold tabular-nums">{v as string | number}</p><Delta value={d as number | null} suffix="" light /></div>
                ))}
              </div>
            </div>
            <div className="card p-5">
              <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted"><Sparkles className="h-4 w-4 text-brand" />Faits marquants</h2>
              {s.highlights.length === 0 ? <p className="mt-4 text-sm text-muted">Pas encore assez de ventes sur cette période.</p> : (
                <ul className="mt-3 space-y-2" data-testid="stats-highlights">
                  {s.highlights.map((h, i) => <li key={i} className="flex items-start gap-2.5 text-sm leading-snug">{h.kind === "good" ? <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-[var(--viz-good)]" /> : h.kind === "warn" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--viz-warn)]" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--viz-6)]" />}<span>{h.text}</span></li>)}
                </ul>
              )}
            </div>
          </section>

          {/* Rentabilité */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="CA HT" value={<Money amount={p.revenueHt} />} delta={pct(p.revenueHt, p.previous?.revenueHt)} icon={<Receipt className="h-4 w-4" />} />
            <Stat label="Marge brute" value={<Money amount={p.revenueHt - p.foodCost} />} hint={p.revenueHt ? `${Math.round(((p.revenueHt - p.foodCost) / p.revenueHt) * 100)} % du CA HT` : undefined} accent="#22c55e" icon={<Percent className="h-4 w-4" />} />
            <Stat label="Coût matière" value={<Money amount={p.foodCost} />} hint={p.foodCostPct !== null ? `${p.foodCostPct} % du CA` : undefined} accent="#f97c3c" icon={<ShoppingBag className="h-4 w-4" />} />
            <Stat label="Coût du personnel" value={<Money amount={s.staff.cost} />} hint={`${s.staff.hours} h · ${s.staff.employees} employés`} accent="#4a3aa7" icon={<Users className="h-4 w-4" />} />
            <Stat label="Remises" value={<Money amount={p.discounts} />} hint={p.revenue ? `${(p.discounts / (p.revenue + p.discounts) * 100).toFixed(1)} % des ventes` : undefined} accent="#eda100" upIsGood={false} />
            <Stat label="Annulations" value={p.cancellations} hint={`${p.refunds ? formatMoney(p.refunds, currency) + " remboursés" : "aucun remboursement"}`} accent="#e5602a" upIsGood={false} />
          </section>
          <section className="card grid gap-5 p-5 md:grid-cols-2 xl:grid-cols-4">
            <Meter label="Ratio coût matière" value={p.foodCostPct} display={p.foodCostPct !== null ? `${p.foodCostPct} %` : undefined} warn={30} bad={35} max={60} hint="Coût matière sur le CA TTC · objectif ≤ 30 %" />
            <Meter label="Coût du personnel" value={s.staff.laborCostPct} display={s.staff.laborCostPct !== null ? `${s.staff.laborCostPct} %` : undefined} warn={30} bad={35} max={60} hint="Salaires sur le CA HT · objectif ≤ 30 %" />
            <Meter label="Matière + personnel" value={s.primeCostPct} display={s.primeCostPct !== null ? `${s.primeCostPct} %` : undefined} warn={60} bad={65} max={100} hint="Matière + personnel sur le CA HT · objectif ≤ 60 %" />
            <Meter label="No-show" value={s.reservations.noShowPct} display={s.reservations.noShowPct !== null ? `${s.reservations.noShowPct} %` : undefined} warn={10} bad={20} max={40} hint={`${s.reservations.noShow} sur ${s.reservations.completed + s.reservations.noShow} réservations honorables`} />
          </section>

          {/* Tendances */}
          <ChartCard title="Chiffre d'affaires par jour" subtitle={p.previous ? `Période précédente : ${formatMoney(p.previous.revenue, currency)}` : undefined}>
            <LineChart data={p.byDay.map((d) => ({ label: d.day.slice(8) + "/" + d.day.slice(5, 7), value: d.revenue, sub: `${d.tickets} tickets · ${d.covers} couverts` }))} currency={currency} height={220} />
          </ChartCard>
          <section className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Par jour de la semaine" subtitle="Où concentrer l'équipe et les promotions"><ColumnChart data={p.byWeekday.map((w) => ({ label: w.label.slice(0, 3), value: w.revenue, sub: `${w.tickets} tickets` }))} currency={currency} color="var(--viz-3)" /></ChartCard>
            <ChartCard title="Par heure" subtitle="Heures de pointe (encaissements)"><ColumnChart data={p.byHour.map((h) => ({ label: `${h.hour}h`, value: h.revenue, sub: `${h.tickets} tickets` }))} currency={currency} color="var(--viz-2)" /></ChartCard>
          </section>

          {/* Produits et équipe */}
          <section className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Top 10 produits" subtitle="Par chiffre d'affaires"><Ranking data={p.byProduct.slice(0, 10).map((x) => ({ label: x.name, value: x.revenue, hint: `× ${x.quantity}` }))} currency={currency} /></ChartCard>
            <ChartCard title="Catégories" subtitle="Part du chiffre d'affaires"><HBars data={p.byCategory.slice(0, 10).map((c) => ({ label: c.name, value: c.revenue, hint: `${c.share} %` }))} currency={currency} /></ChartCard>
            <ChartCard title="Serveurs" subtitle="CA encaissé et panier moyen"><Ranking data={p.byServer.slice(0, 10).map((x) => ({ label: x.name, value: x.revenue, hint: `${x.tickets} tickets · ${formatMoney(x.avgTicket, currency)}` }))} currency={currency} /></ChartCard>
          </section>
          <section className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Moyens de paiement"><StackedBar data={p.byMethod.map((m) => ({ label: PAYMENT_LABEL[m.method] ?? m.method, value: m.amount, hint: `${m.count} paiements` }))} currency={currency} /></ChartCard>
            <ChartCard title="Types de vente" subtitle={s.customers.onlineShare !== null ? `${s.customers.onlineShare} % hors salle (emporter, en ligne, livraison, borne)` : undefined}><StackedBar data={p.byType.map((t) => ({ label: ORDER_TYPE_LABEL[t.type] ?? t.type, value: t.revenue, hint: `${t.tickets} tickets` }))} currency={currency} /></ChartCard>
          </section>

          {/* Cuisine, service, réservations, clients */}
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Préparation moyenne" value={min(s.kitchen.avgPrepSec)} hint={`${s.kitchen.tickets} tickets cuisine${s.kitchen.over15MinPct ? ` · ${s.kitchen.over15MinPct} % > 15 min` : ""}`} accent="#e5602a" icon={<ChefHat className="h-4 w-4" />} />
            <Stat label="Durée d'un repas" value={s.service.avgDurationMin !== null ? `${s.service.avgDurationMin} min` : "—"} hint={`${s.service.dineInTickets} tables · ${s.service.avgCoversPerTable ?? "—"} couverts / table`} accent="#2a78d6" icon={<Receipt className="h-4 w-4" />} />
            <Stat label="Réservations" value={s.reservations.total} hint={`${s.reservations.covers} couverts · ${s.reservations.noShow} no-show · ${s.reservations.cancelled} annulées`} accent="#4a3aa7" icon={<CalendarDays className="h-4 w-4" />} />
            <Stat label="Clients identifiés" value={s.customers.known} hint={`${s.customers.returning} revenus plusieurs fois · ${s.customers.loyaltyOrders} tickets fidélité`} accent="#e87ba4" icon={<Heart className="h-4 w-4" />} />
          </section>
          {s.kitchen.byStation.length ? <ChartCard title="Temps de préparation par poste" subtitle="Moyenne du ticket, de l'envoi à « prêt »"><HBars data={s.kitchen.byStation.map((st) => ({ label: st.name, value: st.avgPrepSec ?? 0, hint: `${st.tickets} tickets` }))} valueLabel={(v) => min(v)} color="var(--viz-2)" /></ChartCard> : null}

          <ChartCard title="Détail par jour">
            <Table head={["Jour", "CA TTC", "Tickets", "Couverts", "Panier moyen"]}>
              {p.byDay.map((d) => <Tr key={d.day}><Td className="font-semibold">{fmtDay(d.day)}</Td><Td><Money amount={d.revenue} /></Td><Td>{d.tickets}</Td><Td>{d.covers}</Td><Td>{d.tickets ? <Money amount={Math.round(d.revenue / d.tickets)} /> : "—"}</Td></Tr>)}
            </Table>
          </ChartCard>
        </div>
      )}
    </div>
  );
}
