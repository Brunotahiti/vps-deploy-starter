"use client";

import { useState } from "react";
import { useSession } from "@/hooks/use-session";
import { Input } from "@/components/ui/field";
import { Spinner, Card } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { formatMoney } from "@/lib/money";
import { addDays, localDay } from "@/lib/dates";
import { PageHeader, Table, Tr, Td, useList } from "@/components/admin/common";
import { Stat, BarChart, HBars } from "@/components/admin/charts";
import { PAYMENT_LABEL, ORDER_TYPE_LABEL } from "@/components/pos/types";
import type { PeriodReport } from "@/components/admin/staff-types";

const PRESETS: [string, (t: string) => [string, string]][] = [
  ["7 jours", (t) => [addDays(t, -6), t]], ["30 jours", (t) => [addDays(t, -29), t]],
  ["Ce mois", (t) => [t.slice(0, 8) + "01", t]], ["Mois dernier", (t) => { const first = t.slice(0, 8) + "01"; const lastPrev = addDays(first, -1); return [lastPrev.slice(0, 8) + "01", lastPrev]; }],
];

/** Rapports périodiques : synthèse, comparaison avec la période précédente, ventilations et exports. */
export default function ReportsPage() {
  const { can, currency, timezone } = useSession();
  const today = localDay(new Date(), timezone);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const r = useList<PeriodReport>(["reports", "period", from, to], `/api/reports/period?from=${from}&to=${to}`);
  const d = r.data;
  const pct = (a: number, b: number | undefined | null) => (b ? ((a - b) / b) * 100 : null);
  return (
    <div>
      <PageHeader title="Rapports & exports" subtitle={d?.previous ? `Comparé à la période précédente (${d.previous.from} → ${d.previous.to})` : "Choisissez une période"} action={
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map(([label, fn]) => <button key={label} onClick={() => { const [f, t] = fn(today); setFrom(f); setTo(t); }} className="touch h-10 rounded-lg surface-2 px-3 text-xs font-bold">{label}</button>)}
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40!" /><span>→</span><Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="w-40!" />
        </div>
      } />
      {r.isLoading || !d ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Chiffre d'affaires TTC" value={<Money amount={d.revenue} />} delta={pct(d.revenue, d.previous?.revenue)} accent="#14aaa3" />
            <Stat label="CA HT" value={<Money amount={d.revenueHt} />} hint={`TVA ${formatMoney(d.tax, currency)}`} />
            <Stat label="Tickets" value={d.tickets} delta={pct(d.tickets, d.previous?.tickets)} accent="#3b82f6" />
            <Stat label="Couverts" value={d.covers} delta={pct(d.covers, d.previous?.covers)} accent="#f97c3c" />
            <Stat label="Panier moyen" value={<Money amount={d.avgTicket} />} delta={pct(d.avgTicket, d.previous?.avgTicket)} accent="#8b5cf6" />
            <Stat label="CA / jour" value={<Money amount={d.days ? Math.round(d.revenue / d.days) : 0} />} hint={`${d.days} jour${d.days > 1 ? "s" : ""}`} />
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Remises" value={<Money amount={d.discounts} />} />
            <Stat label="Pourboires" value={<Money amount={d.tips} />} />
            <Stat label="Remboursements" value={<Money amount={d.refunds} />} />
            <Stat label="Annulations" value={d.cancellations} />
            <Stat label="Coût matière" value={<Money amount={d.foodCost} />} />
            <Stat label="Food cost" value={d.foodCostPct !== null ? `${d.foodCostPct} %` : "—"} hint={d.previous?.foodCostPct !== null && d.previous?.foodCostPct !== undefined ? `période précédente ${d.previous.foodCostPct} %` : undefined} accent={d.foodCostPct !== null && d.foodCostPct > 35 ? "#ef4444" : "#22c55e"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <Card title="CA par jour"><BarChart data={d.byDay.map((x) => ({ label: x.day.slice(8) + "/" + x.day.slice(5, 7), value: x.revenue }))} currency={currency} /></Card>
            <Card title="Exports">
              <ExportRow type="period" label="Rapport de période" from={from} to={to} />
              <ExportRow type="products" label="Ventes par produit" from={from} to={to} />
              {can("orders.view_history") ? <ExportRow type="orders" label="Liste des commandes" from={from} to={to} /> : null}
              {can("staff.manage") ? <ExportRow type="staff" label="Heures et coût du personnel" from={from} to={to} /> : null}
              <p className="mt-2 text-xs text-muted">CSV (séparateur « ; », compatible Excel), classeur Excel multi-feuilles, PDF A4 de synthèse.</p>
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="CA par jour de semaine"><BarChart data={d.byWeekday.map((w) => ({ label: w.label.slice(0, 3), value: w.revenue }))} currency={currency} color="#8b5cf6" /></Card>
            <Card title="CA par heure"><BarChart data={d.byHour.map((h) => ({ label: `${h.hour}h`, value: h.revenue }))} currency={currency} color="#f97316" /></Card>
            <Card title="CA par catégorie"><HBars data={d.byCategory.map((c) => ({ label: c.name, value: c.revenue, hint: `${c.share} % · × ${c.quantity}` }))} currency={currency} /></Card>
            <Card title="Top produits"><HBars data={d.byProduct.slice(0, 12).map((p) => ({ label: p.name, value: p.revenue, hint: `× ${p.quantity}` }))} currency={currency} color="#22c55e" /></Card>
            <Card title="Par serveur"><Table head={["Serveur", "CA", "Tickets", "Panier moyen"]}>{d.byServer.map((s) => <Tr key={s.name}><Td className="font-semibold">{s.name}</Td><Td><Money amount={s.revenue} /></Td><Td>{s.tickets}</Td><Td><Money amount={s.avgTicket} /></Td></Tr>)}</Table></Card>
            <Card title="Paiements et types de vente">
              <HBars data={d.byMethod.map((m) => ({ label: PAYMENT_LABEL[m.method] ?? m.method, value: m.amount, hint: `× ${m.count}` }))} currency={currency} color="#3b82f6" />
              <div className="mt-3 border-t border-line pt-3"><HBars data={d.byType.map((t) => ({ label: ORDER_TYPE_LABEL[t.type] ?? t.type, value: t.revenue, hint: `${t.tickets} tickets` }))} currency={currency} color="#f97c3c" /></div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function ExportRow({ type, label, from, to }: { type: string; label: string; from: string; to: string }) {
  const exp = (format: string) => `/api/reports/export?type=${type}&format=${format}&from=${from}&to=${to}`;
  return <div className="flex items-center justify-between gap-2 py-1.5 text-sm"><span className="font-semibold">{label}</span><span className="flex gap-1"><a href={exp("csv")} className="touch rounded-lg surface-2 px-2.5 py-1 text-xs font-bold">CSV</a><a href={exp("xlsx")} className="touch rounded-lg surface-2 px-2.5 py-1 text-xs font-bold">Excel</a><a href={exp("pdf")} target="_blank" rel="noreferrer" className="touch rounded-lg surface-2 px-2.5 py-1 text-xs font-bold">PDF</a></span></div>;
}
