"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Select, Toggle } from "@/components/ui/field";
import { Spinner, Card } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { formatMoney } from "@/lib/money";
import { addDays, localDay } from "@/lib/dates";
import { Input } from "@/components/ui/field";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { Stat, BarChart } from "@/components/admin/charts";
import type { organizationOverview } from "@/server/services/organization";

type Overview = Awaited<ReturnType<typeof organizationOverview>>;

/** Multi-sites : vue consolidée sur une période, comparaison, copie de catalogue. */
export default function OrganizationPage() {
  const { me, can, currency, timezone } = useSession();
  const act = useAction();
  const today = localDay(new Date(), timezone);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const q = useList<Overview>(["organization", from, to], `/api/organization/overview?from=${from}&to=${to}`, can("reports.view_global"));
  const [copy, setCopy] = useState<{ fromId: string; toId: string; products: boolean; menus: boolean } | null>(null);
  const d = q.data;
  const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  return (
    <div>
      <PageHeader title="Multi-sites" subtitle="Tous vos établissements, consolidés" action={<div className="flex flex-wrap items-center gap-2"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40!" /><span>→</span><Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="w-40!" />{can("establishments.manage") && (me?.establishments?.length ?? 0) > 1 ? <Button variant="secondary" onClick={() => setCopy({ fromId: me!.establishments![0].id, toId: me!.establishments![1].id, products: true, menus: true })}>Copier un catalogue</Button> : null}</div>} />
      {!can("reports.view_global") ? <p className="card p-6 text-sm text-muted">La vue multi-sites est réservée aux comptes disposant du droit « Consulter le CA global ».</p> : q.isLoading || !d ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="CA TTC consolidé" value={<Money amount={d.total.revenue} />} delta={pct(d.total.revenue, d.total.previousRevenue)} />
            <Stat label="CA HT" value={<Money amount={d.total.revenueHt} />} accent="#3b82f6" />
            <Stat label="Tickets" value={d.total.tickets} hint={`${d.total.covers} couverts`} accent="#8b5cf6" />
            <Stat label="Panier moyen" value={<Money amount={d.total.avgTicket} />} accent="#f97c3c" />
          </div>
          <Table head={["Établissement", "CA TTC", "vs période préc.", "Tickets", "Couverts", "Panier moyen", "Food cost", "Remises", "Annul.", "En cours"]}>
            {d.rows.map((r) => { const delta = pct(r.revenue, r.previousRevenue); return <Tr key={r.establishment.id}><Td className="font-semibold">{r.establishment.name}<span className="block text-xs font-normal text-muted">{[r.establishment.city, r.establishment.island].filter(Boolean).join(", ")}</span></Td><Td className="font-bold">{formatMoney(r.revenue, r.establishment.currency)}</Td><Td className={delta === null ? "text-muted" : delta >= 0 ? "text-green-600" : "text-red-600"}>{delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} %`}</Td><Td>{r.tickets}</Td><Td>{r.covers}</Td><Td>{formatMoney(r.avgTicket, r.establishment.currency)}</Td><Td>{r.foodCostPct !== null ? `${r.foodCostPct} %` : "—"}</Td><Td>{formatMoney(r.discounts, r.establishment.currency)}</Td><Td>{r.cancellations}</Td><Td>{r.openOrders}</Td></Tr>; })}
          </Table>
          <div className="grid gap-4 lg:grid-cols-2">{d.rows.map((r) => <Card key={r.establishment.id} title={`${r.establishment.name} — CA par jour`}><BarChart data={r.byDay.map((x) => ({ label: x.day.slice(8) + "/" + x.day.slice(5, 7), value: x.revenue }))} currency={currency} /><p className="mt-2 text-xs text-muted">Top : {r.topProducts.map((p) => `${p.name} (${p.quantity})`).join(" · ") || "—"}</p></Card>)}</div>
        </div>
      )}
      <Modal open={!!copy} onClose={() => setCopy(null)} title="Copier un catalogue" size="sm" footer={<Button className="w-full" disabled={!copy || copy.fromId === copy.toId} onClick={() => copy && act(() => api.post<{ products: number; categories: number; menus: number }>(`/api/establishments/${copy.toId}/copy-catalog`, { fromId: copy.fromId, products: copy.products, menus: copy.menus }), { success: "Catalogue copié", invalidate: [["products"], ["categories"], ["pos-catalog"]] }).then((r) => { if (r) { alert(`${r.categories} catégories, ${r.products} produits, ${r.menus} formules copiés`); setCopy(null); } })}>Copier</Button>}>
        {copy ? <div className="space-y-3"><p className="text-sm text-muted">Catégories, TVA, postes, options, produits et formules sont copiés par nom : les éléments déjà présents ne sont pas dupliqués.</p><Field label="Depuis"><Select value={copy.fromId} onChange={(e) => setCopy({ ...copy, fromId: e.target.value })}>{me?.establishments?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field><Field label="Vers"><Select value={copy.toId} onChange={(e) => setCopy({ ...copy, toId: e.target.value })}>{me?.establishments?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select></Field><Toggle checked={copy.products} onChange={(v) => setCopy({ ...copy, products: v })} label="Produits" /><Toggle checked={copy.menus} onChange={(v) => setCopy({ ...copy, menus: v })} label="Formules" /></div> : null}
      </Modal>
    </div>
  );
}
