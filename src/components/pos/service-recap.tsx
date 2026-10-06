"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Printer, FileText, Receipt, Users, Wallet, TrendingUp, Percent, Ban, ChefHat, Clock, Sparkles, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { api, ApiClientError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { addDays, formatDateTime, formatTime, localDay } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { Money } from "@/components/money";
import { reportPrint, type PrintResult } from "@/lib/print-client";
import { PAYMENT_LABEL } from "./types";
import type { ServiceRecap } from "@/server/services/recap";

const longDate = (day: string) => new Date(day + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const mmss = (s: number) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")}`;
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v.toLocaleString("fr-FR")} %`);

/**
 * Récapitulatif de fin de service : la journée en une page (couverts, chiffre d'affaires, marge, paiements, caisses,
 * serveurs, catégories, produits, heures), imprimable (page A4, imprimante de caisse, ou impression du navigateur).
 */
export function ServiceRecapScreen() {
  const router = useRouter();
  const { toast } = useToast();
  const { currency, timezone, me, can } = useSession();
  const today = localDay(new Date(), timezone);
  const [day, setDay] = useState(today);
  const allowed = can("reports.view") || can("cash.close");
  const q = useQuery({ queryKey: ["recap", day], queryFn: () => api.get<ServiceRecap>(`/api/reports/recap?day=${day}`), enabled: allowed, refetchInterval: day === today ? 60_000 : false, placeholderData: (prev) => prev });
  const printers = useQuery({ queryKey: ["printers"], queryFn: () => api.get<{ id: string; name: string; kind: string; driver: string; isActive: boolean; terminalId: string | null }[]>("/api/printers"), enabled: allowed, staleTime: 300_000 });
  const thermal = (printers.data ?? []).filter((p) => p.kind === "RECEIPT" && p.isActive && p.driver !== "browser" && (!p.terminalId || p.terminalId === me?.terminal?.id)).sort((a, b) => Number(b.terminalId === me?.terminal?.id) - Number(a.terminalId === me?.terminal?.id))[0] ?? null;
  const [printing, setPrinting] = useState(false);
  const printThermal = async () => {
    if (!thermal) return;
    setPrinting(true);
    try { await reportPrint(await api.post<PrintResult>("/api/print", { printerId: thermal.id, kind: "recap", day }), toast, "Récapitulatif"); }
    catch (e) { toast(e instanceof ApiClientError ? e.message : "Impression impossible", "error"); }
    finally { setPrinting(false); }
  };
  const f = (n: number) => formatMoney(n, currency);
  const r = q.data;
  const s = r?.summary;
  const isToday = day === today;
  const delta = s?.previous && s.previous.revenue > 0 ? Math.round(((s.revenue - s.previous.revenue) / s.previous.revenue) * 100) : null;

  if (!allowed) return <div className="p-6 text-center text-sm text-muted">Le récapitulatif de fin de service est réservé aux personnes qui clôturent la caisse ou consultent les rapports.</div>;
  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4 print:max-w-none print:p-0" data-testid="service-recap">
      {/* En-tête : date, navigation, impression */}
      <div className="no-print flex flex-wrap items-center gap-2">
        <button onClick={() => router.push("/pos/cash")} className="touch flex h-11 w-11 items-center justify-center rounded-xl card" aria-label="Retour à la caisse"><ArrowLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-extrabold leading-tight"><Sparkles className="h-5 w-5 text-brand" />Fin de service</h1>
          <p className="truncate text-sm capitalize text-muted">{longDate(day)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setDay(addDays(day, -1))} className="touch flex h-11 w-11 items-center justify-center rounded-xl surface-2" aria-label="Jour précédent"><ChevronLeft className="h-4 w-4" /></button>
          <label className="relative flex h-11 items-center rounded-xl border border-line surface px-3 text-sm font-semibold"><span>{isToday ? "Aujourd'hui" : new Date(day + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span><input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Choisir une date" /></label>
          <button onClick={() => setDay(addDays(day, 1))} disabled={isToday} className="touch flex h-11 w-11 items-center justify-center rounded-xl surface-2 disabled:opacity-40" aria-label="Jour suivant"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="no-print flex flex-wrap gap-2">
        {thermal ? <Button size="lg" loading={printing} onClick={printThermal} data-testid="recap-print-thermal"><Receipt className="h-5 w-5" />Imprimer le ticket · {thermal.name}</Button> : null}
        <a href={`/api/reports/recap/print?day=${day}`} target="_blank" rel="noreferrer" className="touch inline-flex h-14 items-center gap-2 rounded-xl bg-brand px-6 text-base font-bold text-white shadow-glow" data-testid="recap-print-page"><FileText className="h-5 w-5" />Page imprimable (A4 / PDF)</a>
        <Button size="lg" variant="secondary" onClick={() => window.print()}><Printer className="h-5 w-5" />Imprimer cet écran</Button>
      </div>

      {q.isLoading || !r || !s ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <>
          {/* Titre d'impression */}
          <div className="hidden print:block"><h1 className="text-2xl font-extrabold">Récapitulatif de fin de service · {r.establishment.name}</h1><p className="capitalize text-muted">{longDate(day)}</p></div>

          {/* Chiffres phares */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="col-span-2 rounded-3xl bg-gradient-to-br from-lagon-500 to-lagon-700 p-5 text-white shadow-lift lg:col-span-2">
              <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">Chiffre d&apos;affaires TTC</p>
              <p className="mt-1 text-4xl font-extrabold tracking-tight tabular-nums" data-testid="recap-revenue"><Money amount={s.revenue} /></p>
              <p className="mt-1 text-sm opacity-90">{delta !== null ? `${delta >= 0 ? "+" : ""}${delta} % par rapport à il y a 7 jours` : "Pas de comparaison disponible"}{r.service.firstOrderAt && r.service.lastOrderAt ? ` · service de ${formatTime(r.service.firstOrderAt, timezone)} à ${formatTime(r.service.lastOrderAt, timezone)}` : ""}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><p className="text-[10px] font-bold uppercase opacity-75">HT</p><p className="font-bold"><Money amount={s.revenueHt} /></p></div>
                <div><p className="text-[10px] font-bold uppercase opacity-75">TVA</p><p className="font-bold"><Money amount={s.tax} /></p></div>
                <div><p className="text-[10px] font-bold uppercase opacity-75">Net encaissé</p><p className="font-bold"><Money amount={r.netRevenue} /></p></div>
              </div>
            </div>
            <Tile icon={<Users className="h-5 w-5" />} label="Couverts" value={String(s.covers)} sub={`${f(s.avgPerCover)} par couvert`} accent="#f97c3c" testId="recap-covers" />
            <Tile icon={<Receipt className="h-5 w-5" />} label="Tickets" value={String(s.tickets)} sub={`ticket moyen ${f(s.avgTicket)}`} accent="#3b82f6" />
            {r.margin ? <Tile icon={<TrendingUp className="h-5 w-5" />} label="Marge brute HT" value={f(r.margin.gross)} sub={`${pct(r.margin.pct)} du CA HT`} accent={r.margin.pct !== null && r.margin.pct < 60 ? "#f59e0b" : "#22c55e"} testId="recap-margin" /> : null}
            {r.margin ? <Tile icon={<ChefHat className="h-5 w-5" />} label="Coût matière" value={f(r.margin.foodCost)} sub={`${pct(r.margin.foodCostPct)} du CA HT${r.margin.unknownCostProducts ? ` · ${r.margin.unknownCostProducts} produit${r.margin.unknownCostProducts > 1 ? "s" : ""} sans coût` : ""}`} accent={r.margin.foodCostPct !== null && r.margin.foodCostPct > 35 ? "#ef4444" : "#22c55e"} /> : null}
            <Tile icon={<Percent className="h-5 w-5" />} label="Remises" value={f(s.discounts)} sub={r.refunds ? `remboursements ${f(r.refunds)}` : "aucun remboursement"} accent="#8b5cf6" />
            <Tile icon={<Ban className="h-5 w-5" />} label="Annulations" value={String(s.cancellations)} sub={r.service.openOrders ? `${r.service.openOrders} commande${r.service.openOrders > 1 ? "s" : ""} encore ouverte${r.service.openOrders > 1 ? "s" : ""}` : "tout est clôturé"} accent={r.service.openOrders ? "#f59e0b" : "#64748b"} />
            {r.staff ? <Tile icon={<Clock className="h-5 w-5" />} label="Personnel" value={f(r.staff.cost)} sub={`${r.staff.hours} h · ${pct(r.staff.laborCostPct)} du CA HT`} accent="#0ea5e9" /> : null}
            {r.kitchen.tickets ? <Tile icon={<ChefHat className="h-5 w-5" />} label="Cuisine" value={r.kitchen.avgPrepSec !== null ? mmss(r.kitchen.avgPrepSec) : "—"} sub={`préparation moyenne · ${r.kitchen.tickets} bons${r.kitchen.slowest !== null ? ` · max ${mmss(r.kitchen.slowest)}` : ""}`} accent="#f97316" /> : null}
            {r.peakHour ? <Tile icon={<Clock className="h-5 w-5" />} label="Heure de pointe" value={`${r.peakHour.hour} h – ${r.peakHour.hour + 1} h`} sub={`${f(r.peakHour.revenue)} · ${r.peakHour.tickets} ticket${r.peakHour.tickets > 1 ? "s" : ""}`} accent="#14aaa3" /> : null}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Block title="Encaissements" icon={<Wallet className="h-4 w-4" />}>
              {s.byMethod.length === 0 ? <p className="text-sm text-muted">Aucun encaissement</p> : null}
              {s.byMethod.map((m) => <Row key={m.method} label={PAYMENT_LABEL[m.method] ?? m.method} hint={`× ${m.count}`} value={f(m.amount)} />)}
              {s.byMethod.length ? <Row label="Total encaissé" value={f(s.byMethod.reduce((a, m) => a + m.amount, 0))} total /> : null}
            </Block>
            <Block title="Caisses" icon={<Wallet className="h-4 w-4" />}>
              {r.cash.length === 0 ? <p className="text-sm text-muted">Aucune session de caisse ce jour</p> : null}
              {r.cash.map((c) => (
                <div key={c.id} className="mb-3 last:mb-0">
                  <p className="text-sm font-bold">{c.terminal ?? "Caisse"} <span className="font-normal text-muted">· {c.openedBy} · {formatTime(c.openedAt, timezone)}{c.closedAt ? ` → ${formatTime(c.closedAt, timezone)}` : ""}</span> {c.status === "OPEN" ? <span className="ml-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">encore ouverte</span> : null}</p>
                  <Row label="Fond de caisse" value={f(c.openingFloat)} />
                  <Row label="Ventes espèces (net)" value={f(c.cashSales)} />
                  {c.payIns || c.payOuts ? <Row label="Entrées / sorties" value={`${f(c.payIns)} / ${f(c.payOuts)}`} /> : null}
                  <Row label="Espèces théoriques" value={f(c.expectedCash)} />
                  {c.countedCash !== null ? <><Row label="Espèces comptées" value={f(c.countedCash)} /><Row label="Écart" value={f(c.difference ?? 0)} total tone={(c.difference ?? 0) === 0 ? "ok" : "bad"} /></> : null}
                </div>
              ))}
            </Block>
            {r.byType.length > 1 ? <Block title="Par type de vente"><Bars data={r.byType.map((t) => ({ label: t.label, hint: `${t.tickets} ticket${t.tickets > 1 ? "s" : ""} · ${t.covers} couv.`, value: t.revenue }))} f={f} /></Block> : null}
            <Block title="Par serveur" icon={<Users className="h-4 w-4" />}>{s.byServer.length ? <Bars data={s.byServer.map((x) => ({ label: x.name, hint: `${x.tickets} ticket${x.tickets > 1 ? "s" : ""} · moy. ${f(Math.round(x.revenue / x.tickets))}`, value: x.revenue }))} f={f} /> : <p className="text-sm text-muted">Aucune vente</p>}</Block>
            <Block title="Par catégorie">{s.byCategory.length ? <Bars data={s.byCategory.map((c) => ({ label: c.name, hint: `${c.quantity} article${c.quantity > 1 ? "s" : ""}`, value: c.revenue }))} f={f} /> : <p className="text-sm text-muted">Aucune vente</p>}</Block>
            <Block title="Produits les plus vendus">
              {s.byProduct.length === 0 ? <p className="text-sm text-muted">Aucune vente</p> : null}
              {s.byProduct.slice(0, 12).map((p, i) => <Row key={p.name} label={`${i + 1}. ${p.name}`} hint={`× ${p.quantity}${r.margin && p.marginPct !== null ? ` · marge ${p.marginPct} %` : ""}`} value={f(p.revenue)} />)}
            </Block>
            <Block title="Ventes par heure" icon={<Clock className="h-4 w-4" />} className="lg:col-span-2">
              {s.byHour.length ? <Hours data={s.byHour} peak={r.peakHour?.hour ?? null} f={f} /> : <p className="text-sm text-muted">Aucune vente</p>}
            </Block>
          </div>
          <p className="text-center text-xs text-muted">Édité le {formatDateTime(r.generatedAt, timezone)}{s.previous ? ` · il y a 7 jours : ${s.previous.covers} couverts, ${s.previous.tickets} tickets, ${f(s.previous.revenue)}` : ""} · Mauruuru à toute l&apos;équipe !</p>
        </>
      )}
    </div>
  );
}

function Tile({ icon, label, value, sub, accent, testId }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent: string; testId?: string }) {
  return (
    <div className="card p-4" data-testid={testId}>
      <div className="flex items-start justify-between gap-2"><p className="text-[11px] font-bold uppercase tracking-wider text-muted">{label}</p><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: `color-mix(in srgb, ${accent} 14%, transparent)`, color: accent }}>{icon}</span></div>
      <p className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

function Block({ title, icon, children, className = "" }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card min-w-0 p-4 print:break-inside-avoid ${className}`}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted">{icon}{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, hint, value, total = false, tone }: { label: string; hint?: string; value: string; total?: boolean; tone?: "ok" | "bad" }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 text-sm ${total ? "mt-1 border-t border-line pt-2 font-extrabold" : "border-b border-line last:border-0"} ${tone === "ok" ? "text-green-600" : tone === "bad" ? "text-red-600" : ""}`}>
      <span className="min-w-0 truncate">{label}{hint ? <span className="ml-1.5 text-xs font-normal text-muted">{hint}</span> : null}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

/** Barres horizontales : une couleur, la plus grande à 100 %. */
function Bars({ data, f }: { data: { label: string; hint?: string; value: number }[]; f: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate font-semibold">{d.label}{d.hint ? <span className="ml-1.5 text-xs font-normal text-muted">{d.hint}</span> : null}</span><span className="shrink-0 font-bold tabular-nums">{f(d.value)}</span></div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-lagon-500/10"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(2, (d.value / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Colonnes par heure (plage continue), heure de pointe mise en avant. */
function Hours({ data, peak, f }: { data: { hour: number; revenue: number; tickets: number }[]; peak: number | null; f: (n: number) => string }) {
  const first = Math.min(...data.map((h) => h.hour)), last = Math.max(...data.map((h) => h.hour));
  const map = new Map(data.map((h) => [h.hour, h]));
  const hours = Array.from({ length: last - first + 1 }, (_, i) => map.get(first + i) ?? { hour: first + i, revenue: 0, tickets: 0 });
  const max = Math.max(1, ...hours.map((h) => h.revenue));
  return (
    <div className="flex h-40 items-end gap-1">
      {hours.map((h) => (
        <div key={h.hour} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${h.hour} h : ${f(h.revenue)} · ${h.tickets} ticket${h.tickets > 1 ? "s" : ""}`}>
          <span className="text-[10px] font-bold tabular-nums text-muted">{h.revenue ? f(h.revenue).replace(/\s?F CFP|\s?XPF/, "") : ""}</span>
          <div className={`w-full rounded-t-md ${h.hour === peak ? "bg-corail-500" : "bg-brand"}`} style={{ height: `${Math.max(h.revenue ? 4 : 1, (h.revenue / max) * 100)}%` }} />
          <span className="text-[10px] font-semibold text-muted">{h.hour}h</span>
        </div>
      ))}
    </div>
  );
}
