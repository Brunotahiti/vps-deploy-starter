"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { formatMoney } from "@/lib/money";
import { addDays, localDay } from "@/lib/dates";
import { Spinner, Card } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { PageHeader } from "./common";
import { BarChart, HBars, Stat } from "./charts";
import type { DailySummary } from "@/components/pos/types";
import { PAYMENT_LABEL } from "@/components/pos/types";

export function Dashboard() {
  const { me, can, currency, timezone } = useSession();
  const today = localDay(new Date(), timezone);
  const [day, setDay] = useState(today);
  const daily = useQuery({ queryKey: ["reports", "daily", day], queryFn: () => api.get<DailySummary>(`/api/reports/daily?day=${day}`), refetchInterval: 60_000 });
  const range = useQuery({ queryKey: ["reports", "range", day], queryFn: () => api.get<{ day: string; revenue: number; tickets: number; covers: number }[]>(`/api/reports/range?from=${addDays(day, -13)}&to=${day}`) });
  const overview = useQuery({ queryKey: ["reports", "overview", day], queryFn: () => api.get<{ establishment: { id: string; name: string; city: string | null; currency: string }; revenue: number; tickets: number; covers: number; openOrders: number; previousRevenue: number }[]>(`/api/reports/overview?day=${day}`), enabled: can("reports.view_global") && (me?.establishments?.length ?? 0) > 1 });
  const d = daily.data;
  const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);

  return (
    <div>
      <PageHeader title="Tableau de bord" subtitle={me?.establishment?.name} action={
        <div className="flex items-center gap-2">
          <button onClick={() => setDay(addDays(day, -1))} className="touch h-10 rounded-lg surface-2 px-3 text-sm font-bold">‹</button>
          <input type="date" value={day} max={today} onChange={(e) => setDay(e.target.value)} className="h-10 rounded-lg border border-line surface px-2 text-sm" />
          <button onClick={() => setDay(addDays(day, 1))} disabled={day >= today} className="touch h-10 rounded-lg surface-2 px-3 text-sm font-bold disabled:opacity-40">›</button>
          {day !== today ? <button onClick={() => setDay(today)} className="touch h-10 rounded-lg px-3 text-sm font-semibold text-lagon-600">Aujourd&apos;hui</button> : null}
        </div>
      } />
      {daily.isLoading || !d ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Chiffre d'affaires" value={<Money amount={d.revenue} />} delta={d.previous ? pct(d.revenue, d.previous.revenue) : null} />
            <Stat label="Tickets" value={d.tickets} delta={d.previous ? pct(d.tickets, d.previous.tickets) : null} />
            <Stat label="Panier moyen" value={<Money amount={d.avgTicket} />} hint="par ticket" />
            <Stat label="Couverts" value={d.covers} delta={d.previous ? pct(d.covers, d.previous.covers) : null} />
            <Stat label="CA / couvert" value={<Money amount={d.avgPerCover} />} hint={`HT ${formatMoney(d.revenueHt, currency)}`} />
            <Stat label="Commandes ouvertes" value={d.openOrders} hint="en direct" />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Remises" value={<Money amount={d.discounts} />} />
            <Stat label="Annulations" value={d.cancellations} />
            <Stat label="Pourboires" value={<Money amount={d.tips} />} />
            <Stat label="Food cost estimé" value={d.foodCostPct !== null ? `${d.foodCostPct} %` : "—"} hint={`coût matière ${formatMoney(d.foodCost, currency)} · coût personnel : Phase 5`} />
          </div>
          {overview.data && overview.data.length > 1 ? (
            <Card title="Tous les établissements">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {overview.data.map((r) => (
                  <div key={r.establishment.id} className="rounded-xl surface-2 p-3"><p className="font-bold">{r.establishment.name}</p><p className="text-xs text-muted">{r.establishment.city ?? ""}</p><p className="mt-1 text-xl font-extrabold">{formatMoney(r.revenue, r.establishment.currency)}</p><p className="text-xs text-muted">{r.tickets} tickets · {r.covers} couverts · {r.openOrders} en cours{r.previousRevenue ? ` · ${pct(r.revenue, r.previousRevenue)!.toFixed(1)} % vs J-7` : ""}</p></div>
                ))}
              </div>
            </Card>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="CA par heure"><BarChart data={d.byHour.map((h) => ({ label: `${h.hour}h`, value: h.revenue }))} currency={currency} /></Card>
            <Card title="CA par jour (14 jours)"><BarChart data={(range.data ?? []).map((r) => ({ label: r.day.slice(8) + "/" + r.day.slice(5, 7), value: r.revenue }))} currency={currency} color="#f97316" /></Card>
            <Card title="CA par catégorie"><HBars data={d.byCategory.map((c) => ({ label: c.name, value: c.revenue, hint: `× ${c.quantity}` }))} currency={currency} /></Card>
            <Card title="CA par moyen de paiement"><HBars data={d.byMethod.map((m) => ({ label: PAYMENT_LABEL[m.method] ?? m.method, value: m.amount, hint: `× ${m.count}` }))} currency={currency} color="#8b5cf6" /></Card>
            <Card title="CA par serveur"><HBars data={d.byServer.map((s) => ({ label: s.name, value: s.revenue, hint: `${s.tickets} tickets` }))} currency={currency} color="#3b82f6" /></Card>
            <Card title="Top produits"><HBars data={d.byProduct.slice(0, 10).map((p) => ({ label: p.name, value: p.revenue, hint: `× ${p.quantity}` }))} currency={currency} color="#22c55e" /></Card>
          </div>
        </div>
      )}
    </div>
  );
}
