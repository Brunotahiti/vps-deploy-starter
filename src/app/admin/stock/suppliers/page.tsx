"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner, Card } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { StockTabs } from "@/components/admin/stock-tabs";
import { fmtQty, type Ingredient, type Supplier, type SupplierProduct } from "@/components/admin/stock-types";

type SForm = { id?: string; name: string; contactName: string; phone: string; email: string; address: string; notes: string };
type PForm = { id?: string; supplierId: string; name: string; reference: string; ingredientId: string; packSize: string; lastPrice: string };

export default function SuppliersPage() {
  const { can } = useSession();
  const act = useAction();
  const suppliers = useList<Supplier[]>(["stock", "suppliers"], "/api/suppliers");
  const ingredients = useList<Ingredient[]>(["stock", "ingredients"], "/api/stock/ingredients");
  const [sel, setSel] = useState<string | null>(null);
  const products = useList<SupplierProduct[]>(["stock", "supplier-products", sel ?? ""], `/api/suppliers/${sel}/products`, !!sel);
  const [edit, setEdit] = useState<SForm | null>(null);
  const [pedit, setPedit] = useState<PForm | null>(null);
  const manage = can("stock.manage");
  const current = suppliers.data?.find((s) => s.id === sel) ?? null;

  const save = async () => {
    if (!edit) return;
    const body = { name: edit.name, contactName: edit.contactName || null, phone: edit.phone || null, email: edit.email || null, address: edit.address || null, notes: edit.notes || null };
    const r = await act(() => (edit.id ? api.patch(`/api/suppliers/${edit.id}`, body) : api.post<Supplier>("/api/suppliers", body)), { success: "Fournisseur enregistré", invalidate: [["stock", "suppliers"]] });
    if (r) { setEdit(null); if (!edit.id) setSel((r as Supplier).id); }
  };
  const saveProduct = async () => {
    if (!pedit) return;
    const body = { name: pedit.name, reference: pedit.reference || null, ingredientId: pedit.ingredientId || null, packSize: Number(pedit.packSize || 1), lastPrice: Number(pedit.lastPrice || 0) };
    const r = await act(() => (pedit.id ? api.patch(`/api/supplier-products/${pedit.id}`, { ...body, supplierId: pedit.supplierId }) : api.post(`/api/suppliers/${pedit.supplierId}/products`, body)), { success: "Article enregistré", invalidate: [["stock", "supplier-products"], ["stock", "suppliers"]] });
    if (r) setPedit(null);
  };

  return (
    <div>
      <PageHeader title="Fournisseurs" subtitle="Contacts et articles achetés (conditionnement, dernier prix), liés à vos ingrédients" action={manage ? <Button onClick={() => setEdit({ name: "", contactName: "", phone: "", email: "", address: "", notes: "" })}>Nouveau fournisseur</Button> : null} />
      <StockTabs />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card title="Fournisseurs">
          {suppliers.isLoading ? <Spinner /> : <div className="space-y-1">{suppliers.data?.map((s) => <button key={s.id} onClick={() => setSel(s.id)} className={`touch flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${sel === s.id ? "bg-lagon-600 text-white" : "hover:surface-2"}`}><span className="truncate font-semibold">{s.name}</span><span className="text-xs opacity-80">{s._count.products} art.</span></button>)}{suppliers.data?.length === 0 ? <p className="py-4 text-center text-sm text-muted">Aucun fournisseur</p> : null}</div>}
        </Card>
        <Card title={current ? current.name : "Articles"} action={current && manage ? <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEdit({ id: current.id, name: current.name, contactName: current.contactName ?? "", phone: current.phone ?? "", email: current.email ?? "", address: current.address ?? "", notes: current.notes ?? "" })}>Modifier</Button><Button size="sm" onClick={() => setPedit({ supplierId: current.id, name: "", reference: "", ingredientId: "", packSize: "1", lastPrice: "0" })}>+ Article</Button></div> : null}>
          {!current ? <p className="py-8 text-center text-sm text-muted">Choisissez un fournisseur.</p> : (
            <div>
              <p className="mb-3 text-sm text-muted">{[current.contactName, current.phone, current.email, current.address].filter(Boolean).join(" · ") || "Aucune coordonnée"}{current.notes ? <span className="block italic">{current.notes}</span> : null}</p>
              {products.isLoading ? <Spinner /> : (
                <Table head={["Article", "Réf.", "Ingrédient", "Conditionnement", "Dernier prix", "Prix / unité", ""]}>
                  {products.data?.map((p) => <Tr key={p.id}><Td className="font-semibold">{p.name}</Td><Td className="text-xs">{p.reference ?? ""}</Td><Td>{p.ingredient ? `${p.ingredient.name} (stock ${fmtQty(p.ingredient.stockQty, p.ingredient.unit)})` : <span className="text-muted">—</span>}</Td><Td>{fmtQty(p.packSize, p.ingredient?.unit)}</Td><Td><Money amount={p.lastPrice} /></Td><Td className="text-xs text-muted">{p.ingredient && p.packSize ? <Money amount={Math.round(p.lastPrice / p.packSize)} /> : "—"}</Td>
                    <Td className="space-x-3 whitespace-nowrap">{manage ? <><button onClick={() => setPedit({ id: p.id, supplierId: p.supplierId, name: p.name, reference: p.reference ?? "", ingredientId: p.ingredientId ?? "", packSize: String(p.packSize), lastPrice: String(p.lastPrice) })} className="text-xs font-semibold text-lagon-600">Modifier</button><button onClick={() => confirm(`Supprimer « ${p.name} » ?`) && act(() => api.delete(`/api/supplier-products/${p.id}`), { success: "Supprimé", invalidate: [["stock", "supplier-products"], ["stock", "suppliers"]] })} className="text-xs font-semibold text-red-600">Supprimer</button></> : null}</Td></Tr>)}
                  {products.data?.length === 0 ? <Tr><Td className="py-6 text-center text-muted">Aucun article : ajoutez ce que vous achetez chez ce fournisseur.</Td></Tr> : null}
                </Table>
              )}
              {manage ? <button onClick={() => confirm(`Archiver « ${current.name} » ?`) && act(() => api.delete(`/api/suppliers/${current.id}`), { success: "Fournisseur archivé", invalidate: [["stock", "suppliers"]] }).then(() => setSel(null))} className="mt-3 text-xs font-semibold text-red-600">Archiver ce fournisseur</button> : null}
            </div>
          )}
        </Card>
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier le fournisseur" : "Nouveau fournisseur"} size="md" footer={<Button className="w-full" disabled={!edit?.name} onClick={save}>Enregistrer</Button>}>
        {edit ? <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom" className="sm:col-span-2"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Contact"><Input value={edit.contactName} onChange={(e) => setEdit({ ...edit, contactName: e.target.value })} /></Field>
          <Field label="Téléphone"><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label="Adresse"><Input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </div> : null}
      </Modal>
      <Modal open={!!pedit} onClose={() => setPedit(null)} title={pedit?.id ? "Modifier l'article" : "Nouvel article fournisseur"} size="md" footer={<Button className="w-full" disabled={!pedit?.name} onClick={saveProduct}>Enregistrer</Button>}>
        {pedit ? <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Désignation" className="sm:col-span-2"><Input value={pedit.name} onChange={(e) => setPedit({ ...pedit, name: e.target.value })} placeholder="Thon rouge longe 5 kg, Carton Hinano 24 × 33 cl…" /></Field>
          <Field label="Référence"><Input value={pedit.reference} onChange={(e) => setPedit({ ...pedit, reference: e.target.value })} /></Field>
          <Field label="Ingrédient alimenté"><Select value={pedit.ingredientId} onChange={(e) => setPedit({ ...pedit, ingredientId: e.target.value })}><option value="">— aucun —</option>{ingredients.data?.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</Select></Field>
          <Field label="Conditionnement (quantité d'ingrédient par unité achetée)" hint="Ex. carton de 24 bouteilles → 24 ; longe de 5 kg avec ingrédient en g → 5000"><Input type="number" step="0.001" value={pedit.packSize} onChange={(e) => setPedit({ ...pedit, packSize: e.target.value })} /></Field>
          <Field label="Dernier prix (F, par unité achetée)"><Input type="number" value={pedit.lastPrice} onChange={(e) => setPedit({ ...pedit, lastPrice: e.target.value })} /></Field>
        </div> : null}
      </Modal>
    </div>
  );
}
