"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { formatBps } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Toggle } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { CatalogTabs } from "@/components/admin/catalog-tabs";
import { PhotoField } from "@/components/photo-field";
import type { listMenus, listProducts } from "@/server/services/catalog";
import type { TaxRate } from "@/generated/prisma/client";

type Menu = Awaited<ReturnType<typeof listMenus>>[number];
type Product = Awaited<ReturnType<typeof listProducts>>[number];
type Form = { id?: string; name: string; description: string; imageUrl: string; priceTtc: string; taxRateId: string; isActive: boolean; sections: { name: string; minSelect: string; maxSelect: string; items: { productId: string; supplement: string }[] }[] };

export default function MenusPage() {
  const act = useAction();
  const q = useList<Menu[]>(["menus"], "/api/menus?all=1");
  const products = useList<Product[]>(["products"], "/api/products?all=1");
  const taxRates = useList<TaxRate[]>(["tax-rates"], "/api/tax-rates");
  const [edit, setEdit] = useState<Form | null>(null);
  const [picker, setPicker] = useState<number | null>(null);
  const save = async () => {
    if (!edit) return;
    const body = { name: edit.name, description: edit.description || null, imageUrl: edit.imageUrl || null, priceTtc: Number(edit.priceTtc), taxRateId: edit.taxRateId || null, isActive: edit.isActive, sections: edit.sections.filter((s) => s.name).map((s) => ({ name: s.name, minSelect: Number(s.minSelect || 0), maxSelect: Number(s.maxSelect || 1), items: s.items.map((i) => ({ productId: i.productId, supplement: Number(i.supplement || 0) })) })) };
    const r = await act(() => (edit.id ? api.patch(`/api/menus/${edit.id}`, body) : api.post("/api/menus", body)), { success: "Formule enregistrée", invalidate: [["menus"], ["pos-catalog"]] });
    if (r) setEdit(null);
  };
  const setSection = (i: number, patch: Partial<Form["sections"][number]>) => setEdit((e) => (e ? { ...e, sections: e.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) } : e));
  const pname = (id: string) => products.data?.find((p) => p.id === id)?.name ?? "?";
  return (
    <div>
      <PageHeader title="Catalogue" subtitle="Formules : Menu déjeuner 3 500 F = 1 entrée + 1 plat + 1 dessert, avec suppléments" action={<Button onClick={() => setEdit({ name: "", description: "", imageUrl: "", priceTtc: "", taxRateId: taxRates.data?.find((t) => t.isDefault)?.id ?? "", isActive: true, sections: [{ name: "Entrée", minSelect: "1", maxSelect: "1", items: [] }, { name: "Plat", minSelect: "1", maxSelect: "1", items: [] }, { name: "Dessert", minSelect: "1", maxSelect: "1", items: [] }] })}>Nouvelle formule</Button>} />
      <CatalogTabs />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Formule", "Prix", "TVA", "Composition", "Statut", ""]}>
          {q.data?.map((m) => (
            <Tr key={m.id}>
              <Td className="font-semibold">{m.name}<span className="block text-xs font-normal text-muted">{m.description}</span></Td><Td className="font-semibold"><Money amount={m.priceTtc} /></Td><Td>{m.taxRate ? formatBps(m.taxRate.rateBps) : "—"}</Td>
              <Td>{m.sections.map((s) => <span key={s.id} className="mr-2 inline-block rounded-md surface-2 px-1.5 py-0.5 text-xs">{s.name} ({s.items.length})</span>)}</Td><Td>{m.isActive ? <Badge color="green">active</Badge> : <Badge color="gray">inactive</Badge>}</Td>
              <Td className="space-x-3"><button onClick={() => setEdit({ id: m.id, name: m.name, description: m.description ?? "", imageUrl: m.imageUrl ?? "", priceTtc: String(m.priceTtc), taxRateId: m.taxRateId ?? "", isActive: m.isActive, sections: m.sections.map((s) => ({ name: s.name, minSelect: String(s.minSelect), maxSelect: String(s.maxSelect), items: s.items.map((i) => ({ productId: i.productId, supplement: String(i.supplement) })) })) })} className="text-xs font-semibold text-lagon-600">Modifier</button><button onClick={() => confirm(`Supprimer « ${m.name} » ?`) && act(() => api.delete(`/api/menus/${m.id}`), { success: "Supprimée", invalidate: [["menus"], ["pos-catalog"]] })} className="text-xs font-semibold text-red-600">Supprimer</button></Td>
            </Tr>
          ))}
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier la formule" : "Nouvelle formule"} size="xl" footer={<Button className="w-full" disabled={!edit?.name || edit.priceTtc === "" || !edit.sections.some((s) => s.items.length)} onClick={save}>Enregistrer</Button>}>
        {edit ? <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nom"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Prix TTC"><Input type="number" value={edit.priceTtc} onChange={(e) => setEdit({ ...edit, priceTtc: e.target.value })} /></Field>
            <Field label="TVA"><Select value={edit.taxRateId} onChange={(e) => setEdit({ ...edit, taxRateId: e.target.value })}><option value="">Aucune</option>{taxRates.data?.map((t) => <option key={t.id} value={t.id}>{t.name} — {formatBps(t.rateBps)}</option>)}</Select></Field>
            <Field label="Description" className="sm:col-span-2"><Input value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <div className="sm:col-span-2"><PhotoField value={edit.imageUrl} onChange={(v) => setEdit({ ...edit, imageUrl: v })} label="Photo de la formule" /></div>
            <div className="flex items-end"><Toggle checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Active" /></div>
          </div>
          {edit.sections.map((s, i) => (
            <div key={i} className="rounded-xl border border-line p-3">
              <div className="mb-2 flex flex-wrap items-end gap-2"><Field label="Étape"><Input value={s.name} onChange={(e) => setSection(i, { name: e.target.value })} className="w-40" /></Field><Field label="Min"><Input type="number" value={s.minSelect} onChange={(e) => setSection(i, { minSelect: e.target.value })} className="w-20" /></Field><Field label="Max"><Input type="number" value={s.maxSelect} onChange={(e) => setSection(i, { maxSelect: e.target.value })} className="w-20" /></Field><Button variant="ghost" onClick={() => setEdit({ ...edit, sections: edit.sections.filter((_, j) => j !== i) })}>Retirer l&apos;étape</Button></div>
              <div className="space-y-1">{s.items.map((it, k) => <div key={k} className="flex items-center gap-2 text-sm"><span className="flex-1">{pname(it.productId)}</span><span className="text-xs text-muted">Supplément</span><Input type="number" value={it.supplement} onChange={(e) => setSection(i, { items: s.items.map((x, l) => (l === k ? { ...x, supplement: e.target.value } : x)) })} className="w-28" /><button onClick={() => setSection(i, { items: s.items.filter((_, l) => l !== k) })} className="text-red-600">✕</button></div>)}</div>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setPicker(i)}>+ Ajouter des produits</Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => setEdit({ ...edit, sections: [...edit.sections, { name: "", minSelect: "1", maxSelect: "1", items: [] }] })}>+ Étape</Button>
        </div> : null}
      </Modal>
      <Modal open={picker !== null} onClose={() => setPicker(null)} title="Choisir des produits" size="lg">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{products.data?.filter((p) => p.isActive).map((p) => { const on = picker !== null && edit?.sections[picker]?.items.some((i) => i.productId === p.id); return <button key={p.id} onClick={() => { if (picker === null || !edit) return; const s = edit.sections[picker]; setSection(picker, { items: on ? s.items.filter((i) => i.productId !== p.id) : [...s.items, { productId: p.id, supplement: "0" }] }); }} className={`touch rounded-lg border px-2 py-2 text-left text-sm ${on ? "border-lagon-500 bg-lagon-500/10" : "border-line"}`}>{p.name}<span className="block text-xs text-muted"><Money amount={p.priceTtc} /></span></button>; })}</div>
      </Modal>
    </div>
  );
}
