"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner, Badge, Card } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { formatDate, formatDateTime } from "@/lib/dates";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { StockTabs } from "@/components/admin/stock-tabs";
import { PO_STATUS_LABEL, fmtQty, type PurchaseOrder, type Supplier, type SupplierProduct, type Suggestion } from "@/components/admin/stock-types";

type Line = { supplierProductId: string; quantity: string; unitPrice: string };
type Form = { id?: string; supplierId: string; expectedAt: string; notes: string; lines: Line[] };

export default function PurchaseOrdersPage() {
  const { can, timezone } = useSession();
  const act = useAction();
  const manage = can("stock.manage");
  const [status, setStatus] = useState("");
  const orders = useList<PurchaseOrder[]>(["stock", "purchase-orders", status], `/api/purchase-orders${status ? `?status=${status}` : ""}`);
  const suppliers = useList<Supplier[]>(["stock", "suppliers"], "/api/suppliers");
  const suggestions = useList<Suggestion[]>(["stock", "suggest"], "/api/stock/suggest");
  const [form, setForm] = useState<Form | null>(null);
  const [view, setView] = useState<PurchaseOrder | null>(null);
  const [receive, setReceive] = useState<{ po: PurchaseOrder; qty: Record<string, string> } | null>(null);
  const sps = useQuery({ queryKey: ["stock", "supplier-products", form?.supplierId ?? ""], queryFn: () => api.get<SupplierProduct[]>(`/api/suppliers/${form?.supplierId}/products`), enabled: !!form?.supplierId });
  const sp = (id: string) => sps.data?.find((x) => x.id === id);
  const total = (f: Form) => f.lines.reduce((a, l) => a + Math.round(Number(l.quantity || 0) * Number(l.unitPrice || sp(l.supplierProductId)?.lastPrice || 0)), 0);
  const badge = (s: string) => <Badge color={s === "RECEIVED" ? "green" : s === "PARTIALLY_RECEIVED" ? "orange" : s === "SENT" ? "blue" : s === "CANCELLED" ? "red" : "gray"}>{PO_STATUS_LABEL[s]}</Badge>;
  const inv = [["stock"]];

  const save = async () => {
    if (!form) return;
    const body = { supplierId: form.supplierId, expectedAt: form.expectedAt || null, notes: form.notes || null, lines: form.lines.filter((l) => l.supplierProductId && Number(l.quantity) > 0).map((l) => ({ supplierProductId: l.supplierProductId, quantity: Number(l.quantity), unitPrice: l.unitPrice ? Number(l.unitPrice) : null })) };
    const r = await act(() => (form.id ? api.patch(`/api/purchase-orders/${form.id}`, { expectedAt: body.expectedAt, notes: body.notes, lines: body.lines }) : api.post("/api/purchase-orders", body)), { success: "Bon enregistré", invalidate: inv });
    if (r) setForm(null);
  };
  const fromSuggestion = (s: Suggestion) => setForm({ supplierId: s.supplier.id, expectedAt: "", notes: "Suggestion automatique (ingrédients sous le seuil)", lines: s.lines.map((l) => ({ supplierProductId: l.supplierProductId, quantity: String(l.suggestedPacks), unitPrice: String(l.unitPrice) })) });
  const doReceive = async () => {
    if (!receive) return;
    const r = await act(() => api.post(`/api/purchase-orders/${receive.po.id}/receive`, { lines: receive.po.lines.map((l) => ({ lineId: l.id, receivedQty: Number(receive.qty[l.id] ?? l.receivedQty) })) }), { success: "Réception enregistrée, stock mis à jour", invalidate: [...inv, ["pos-catalog"], ["products"]] });
    if (r) { setReceive(null); setView(null); }
  };

  return (
    <div>
      <PageHeader title="Bons de commande" subtitle="Commandes fournisseurs, réceptions et entrées en stock" action={manage ? <Button onClick={() => setForm({ supplierId: suppliers.data?.[0]?.id ?? "", expectedAt: "", notes: "", lines: [{ supplierProductId: "", quantity: "1", unitPrice: "" }] })}>Nouveau bon</Button> : null} />
      <StockTabs />
      {suggestions.data && suggestions.data.length > 0 ? (
        <Card title="À commander (ingrédients sous le seuil)" className="mb-4">
          <div className="grid gap-2 md:grid-cols-2">
            {suggestions.data.map((s) => <div key={s.supplier.id} className="rounded-xl surface-2 p-3"><div className="flex items-center justify-between"><p className="font-bold">{s.supplier.name}</p>{manage ? <Button size="sm" variant="secondary" onClick={() => fromSuggestion(s)}>Préparer le bon · <Money amount={s.total} /></Button> : null}</div><ul className="mt-1 text-xs text-muted">{s.lines.map((l) => <li key={l.supplierProductId}>{l.ingredient} : {fmtQty(l.stockQty, l.unit)} / seuil {fmtQty(l.stockMin, l.unit)} → {l.suggestedPacks} × {l.name}</li>)}</ul></div>)}
          </div>
        </Card>
      ) : null}
      <div className="mb-3"><Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-56!"><option value="">Tous les statuts</option>{Object.entries(PO_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
      {orders.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["N°", "Fournisseur", "Créé le", "Livraison prévue", "Lignes", "Total", "Statut"]}>
          {orders.data?.map((po) => <Tr key={po.id} onClick={() => setView(po)}><Td className="font-mono text-xs">{po.number}</Td><Td className="font-semibold">{po.supplier.name}</Td><Td className="text-xs">{formatDateTime(po.createdAt, timezone)}</Td><Td className="text-xs">{po.expectedAt ? formatDate(po.expectedAt, timezone) : "—"}</Td><Td>{po.lines.length}</Td><Td className="font-semibold"><Money amount={po.total} /></Td><Td>{badge(po.status)}</Td></Tr>)}
          {orders.data?.length === 0 ? <Tr><Td className="py-8 text-center text-muted">Aucun bon de commande</Td></Tr> : null}
        </Table>
      )}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Modifier le bon" : "Nouveau bon de commande"} size="lg" footer={<div className="flex items-center justify-between gap-3"><span className="text-lg font-extrabold">Total <Money amount={form ? total(form) : 0} /></span><Button disabled={!form?.supplierId || !form.lines.some((l) => l.supplierProductId && Number(l.quantity) > 0)} onClick={save}>Enregistrer le brouillon</Button></div>}>
        {form ? <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fournisseur"><Select value={form.supplierId} disabled={!!form.id} onChange={(e) => setForm({ ...form, supplierId: e.target.value, lines: [{ supplierProductId: "", quantity: "1", unitPrice: "" }] })}><option value="">—</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Livraison prévue"><Input type="date" value={form.expectedAt} onChange={(e) => setForm({ ...form, expectedAt: e.target.value })} /></Field>
          </div>
          <div className="space-y-2">
            {form.lines.map((l, i) => { const p = sp(l.supplierProductId); return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select value={l.supplierProductId} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, supplierProductId: e.target.value, unitPrice: String(sp(e.target.value)?.lastPrice ?? "") } : x)) })} className="min-w-0 flex-1"><option value="">— article —</option>{sps.data?.map((x) => <option key={x.id} value={x.id}>{x.name}{x.ingredient ? ` → ${x.ingredient.name}` : ""}</option>)}</Select>
                <Input type="number" step="0.001" value={l.quantity} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)) })} className="w-24!" placeholder="Qté" />
                <Input type="number" value={l.unitPrice} onChange={(e) => setForm({ ...form, lines: form.lines.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)) })} className="w-28!" placeholder="Prix unit." />
                <span className="w-24 text-right text-sm font-semibold"><Money amount={Math.round(Number(l.quantity || 0) * Number(l.unitPrice || p?.lastPrice || 0))} /></span>
                <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, lines: form.lines.filter((_, j) => j !== i) })}>✕</Button>
              </div>
            ); })}
            <Button size="sm" variant="outline" onClick={() => setForm({ ...form, lines: [...form.lines, { supplierProductId: "", quantity: "1", unitPrice: "" }] })}>+ Ligne</Button>
            {form.supplierId && sps.data?.length === 0 ? <p className="text-sm text-muted">Ce fournisseur n&apos;a pas encore d&apos;articles : ajoutez-les dans l&apos;onglet Fournisseurs.</p> : null}
          </div>
          <Field label="Notes"><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
        </div> : null}
      </Modal>

      <Modal open={!!view} onClose={() => setView(null)} title={view ? `${view.number} · ${view.supplier.name}` : ""} size="lg" footer={view && manage ? <div className="flex flex-wrap justify-end gap-2">
        {view.status === "DRAFT" ? <><Button variant="outline" onClick={() => { setForm({ id: view.id, supplierId: view.supplierId, expectedAt: view.expectedAt ? String(view.expectedAt).slice(0, 10) : "", notes: view.notes ?? "", lines: view.lines.map((l) => ({ supplierProductId: l.supplierProductId, quantity: String(l.quantity), unitPrice: String(l.unitPrice) })) }); setView(null); }}>Modifier</Button><Button onClick={() => act(() => api.post(`/api/purchase-orders/${view.id}/send`), { success: "Bon marqué envoyé", invalidate: inv }).then(() => setView(null))}>Marquer envoyé</Button></> : null}
        {view.status === "DRAFT" || view.status === "SENT" || view.status === "PARTIALLY_RECEIVED" ? <Button variant="accent" onClick={() => setReceive({ po: view, qty: Object.fromEntries(view.lines.map((l) => [l.id, String(l.quantity)])) })}>Réceptionner</Button> : null}
        {view.status === "DRAFT" || view.status === "SENT" ? <Button variant="danger" onClick={() => confirm("Annuler ce bon ?") && act(() => api.post(`/api/purchase-orders/${view.id}/cancel`), { success: "Bon annulé", invalidate: inv }).then(() => setView(null))}>Annuler</Button> : null}
      </div> : undefined}>
        {view ? <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">{badge(view.status)}<span>Créé le {formatDateTime(view.createdAt, timezone)}</span>{view.expectedAt ? <span>· livraison prévue {formatDate(view.expectedAt, timezone)}</span> : null}{view.receivedAt ? <span>· reçu le {formatDateTime(view.receivedAt, timezone)}</span> : null}</div>
          <Table head={["Article", "Ingrédient", "Commandé", "Reçu", "Prix unit.", "Total"]}>
            {view.lines.map((l) => <Tr key={l.id}><Td className="font-semibold">{l.supplierProduct.name}</Td><Td className="text-xs">{l.supplierProduct.ingredient ? `${l.supplierProduct.ingredient.name} (× ${fmtQty(l.supplierProduct.packSize)} ${l.supplierProduct.ingredient.unit})` : "—"}</Td><Td>{fmtQty(l.quantity)}</Td><Td className={l.receivedQty >= l.quantity ? "text-green-600 font-semibold" : l.receivedQty > 0 ? "text-orange-600 font-semibold" : ""}>{fmtQty(l.receivedQty)}</Td><Td><Money amount={l.unitPrice} /></Td><Td className="font-semibold"><Money amount={l.lineTotal} /></Td></Tr>)}
          </Table>
          <p className="text-right text-lg font-extrabold">Total <Money amount={view.total} /></p>
          {view.notes ? <p className="text-sm italic text-muted">{view.notes}</p> : null}
        </div> : null}
      </Modal>

      <Modal open={!!receive} onClose={() => setReceive(null)} title={receive ? `Réception — ${receive.po.number}` : ""} size="md" footer={<Button className="w-full" onClick={doReceive}>Valider la réception</Button>}>
        {receive ? <div className="space-y-2">
          <p className="text-sm text-muted">Indiquez les quantités réellement reçues (cumul). Les ingrédients liés entrent en stock au prix du bon ; le coût moyen est recalculé.</p>
          {receive.po.lines.map((l) => <div key={l.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-semibold">{l.supplierProduct.name}<span className="block text-xs font-normal text-muted">commandé {fmtQty(l.quantity)} · déjà reçu {fmtQty(l.receivedQty)}</span></span><Input type="number" step="0.001" value={receive.qty[l.id] ?? ""} onChange={(e) => setReceive({ ...receive, qty: { ...receive.qty, [l.id]: e.target.value } })} className="w-28!" /></div>)}
        </div> : null}
      </Modal>
    </div>
  );
}
