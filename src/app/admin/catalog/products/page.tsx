"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { formatBps } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea, Toggle } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { CatalogTabs } from "@/components/admin/catalog-tabs";
import { PhotoField, QuickPhoto } from "@/components/photo-field";
import type { listProducts, listCategories, listModifierGroups, listKitchenStations } from "@/server/services/catalog";
import type { TaxRate } from "@/generated/prisma/client";

type Product = Awaited<ReturnType<typeof listProducts>>[number];
type Form = { name: string; description: string; categoryId: string; taxRateId: string; kitchenStationId: string; priceTtc: string; costPrice: string; sku: string; barcode: string; color: string; imageUrl: string; isAvailable: boolean; isActive: boolean; trackStock: boolean; stockQty: string; stockMin: string; variants: { id?: string; name: string; priceTtc: string }[]; modifierGroupIds: string[]; availability: { days: number[]; from: string; to: string } | null };

const empty: Form = { name: "", description: "", categoryId: "", taxRateId: "", kitchenStationId: "", priceTtc: "", costPrice: "0", sku: "", barcode: "", color: "", imageUrl: "", isAvailable: true, isActive: true, trackStock: false, stockQty: "0", stockMin: "0", variants: [], modifierGroupIds: [], availability: null };
const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export default function ProductsPage() {
  const { can } = useSession();
  const act = useAction();
  const products = useList<Product[]>(["products"], "/api/products?all=1");
  const categories = useList<Awaited<ReturnType<typeof listCategories>>>(["categories"], "/api/categories");
  const taxRates = useList<TaxRate[]>(["tax-rates"], "/api/tax-rates");
  const groups = useList<Awaited<ReturnType<typeof listModifierGroups>>>(["modifier-groups"], "/api/modifier-groups");
  const stations = useList<Awaited<ReturnType<typeof listKitchenStations>>>(["stations"], "/api/kitchen-stations");
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [noPhoto, setNoPhoto] = useState(false);
  const [edit, setEdit] = useState<{ id?: string; form: Form } | null>(null);
  const [saving, setSaving] = useState(false);

  const list = useMemo(() => (products.data ?? []).filter((p) => (!cat || p.categoryId === cat) && (!noPhoto || !p.imageUrl) && (!search || p.name.toLowerCase().includes(search.toLowerCase()) || p.sku?.toLowerCase().includes(search.toLowerCase()))), [products.data, cat, search, noPhoto]);
  const missingPhotos = (products.data ?? []).filter((p) => p.isActive && !p.imageUrl).length;
  const setPhoto = (p: Product, url: string) => act(() => api.patch(`/api/products/${p.id}`, { imageUrl: url }), { success: `Photo de « ${p.name} » enregistrée`, invalidate: [["products"], ["pos-catalog"]] });
  const openNew = () => setEdit({ form: { ...empty, taxRateId: taxRates.data?.find((t) => t.isDefault)?.id ?? "", categoryId: cat } });
  const openEdit = (p: Product) => setEdit({ id: p.id, form: { name: p.name, description: p.description ?? "", categoryId: p.categoryId ?? "", taxRateId: p.taxRateId ?? "", kitchenStationId: p.kitchenStationId ?? "", priceTtc: String(p.priceTtc), costPrice: String(p.costPrice), sku: p.sku ?? "", barcode: p.barcode ?? "", color: p.color ?? "", imageUrl: p.imageUrl ?? "", isAvailable: p.isAvailable, isActive: p.isActive, trackStock: p.trackStock, stockQty: String(p.stockQty), stockMin: String(p.stockMin), variants: p.variants.map((v) => ({ id: v.id, name: v.name, priceTtc: String(v.priceTtc) })), modifierGroupIds: p.modifierGroups.map((g) => g.modifierGroupId), availability: (p.availability as Form["availability"]) ?? null } });
  const f = edit?.form;
  const set = (patch: Partial<Form>) => setEdit((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  const save = async () => {
    if (!edit || !f) return;
    setSaving(true);
    const body = { name: f.name, description: f.description || null, categoryId: f.categoryId || null, taxRateId: f.taxRateId || null, kitchenStationId: f.kitchenStationId || null, priceTtc: Number(f.priceTtc), costPrice: Number(f.costPrice || 0), sku: f.sku || null, barcode: f.barcode || null, color: f.color || null, imageUrl: f.imageUrl || null, isAvailable: f.isAvailable, isActive: f.isActive, trackStock: f.trackStock, stockQty: Number(f.stockQty || 0), stockMin: Number(f.stockMin || 0), variants: f.variants.filter((v) => v.name).map((v) => ({ id: v.id, name: v.name, priceTtc: Number(v.priceTtc || 0) })), modifierGroupIds: f.modifierGroupIds, availability: f.availability };
    const r = await act(() => (edit.id ? api.patch(`/api/products/${edit.id}`, body) : api.post("/api/products", body)), { success: "Produit enregistré", invalidate: [["products"], ["pos-catalog"], ["categories"]] });
    setSaving(false);
    if (r) setEdit(null);
  };
  const margin = f && Number(f.priceTtc) > 0 ? Math.round(((Number(f.priceTtc) - Number(f.costPrice || 0)) / Number(f.priceTtc)) * 1000) / 10 : null;

  return (
    <div>
      <PageHeader title="Catalogue" subtitle="Produits, prix TTC, TVA, coût matière, options, disponibilité" action={can("catalog.manage") ? <Button onClick={openNew}>Nouveau produit</Button> : null} />
      <CatalogTabs />
      <div className="mb-3 flex flex-wrap gap-2"><Input placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" /><Select value={cat} onChange={(e) => setCat(e.target.value)} className="max-w-xs"><option value="">Toutes catégories</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>{missingPhotos > 0 || noPhoto ? <button type="button" onClick={() => setNoPhoto(!noPhoto)} aria-pressed={noPhoto} className={`touch inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold ${noPhoto ? "bg-brand text-white" : "surface-2"}`}>Sans photo<span className={`rounded-full px-2 text-xs font-bold ${noPhoto ? "bg-white/20" : "bg-orange-500/15 text-orange-600"}`}>{missingPhotos}</span></button> : null}</div>
      {can("catalog.manage") && (products.data?.length ?? 0) > 0 ? <p className="mb-3 text-xs text-muted">Astuce : touchez la vignette d&apos;un plat pour le prendre en photo ou choisir une image. Elle apparaît aussitôt en caisse, sur le menu QR et sur la commande en ligne.</p> : null}
      {products.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Produit", "Catégorie", "Prix TTC", "TVA", "Coût", "Marge", "Poste", "Options", "Dispo", ""]}>
          {list.map((p) => {
            const m = p.priceTtc > 0 ? Math.round(((p.priceTtc - p.costPrice) / p.priceTtc) * 100) : 0;
            return (
              <Tr key={p.id} onClick={() => can("catalog.manage") && openEdit(p)}>
                <Td><span className="flex items-center gap-2">
                  {can("catalog.manage") ? <QuickPhoto value={p.imageUrl} label={p.imageUrl ? `Changer la photo de ${p.name}` : `Ajouter une photo à ${p.name}`} onUploaded={(url) => setPhoto(p, url)} /> : p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- vignette du catalogue
                    <img src={p.imageUrl} alt="" className="h-10 w-14 shrink-0 rounded-lg object-cover" />
                  ) : <span className="h-10 w-14 shrink-0 rounded-lg surface-2" />}<span><span className="font-semibold">{p.name}</span>{!p.isActive ? <Badge color="gray">archivé</Badge> : null}<span className="block text-xs text-muted">{p.sku ?? ""}</span></span></span></Td><Td><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.category?.color }} /> {p.category?.name ?? "—"}</Td><Td className="font-semibold"><Money amount={p.priceTtc} /></Td><Td>{p.taxRate ? formatBps(p.taxRate.rateBps) : "—"}</Td><Td><Money amount={p.costPrice} /></Td>
                <Td><span className={m < 60 ? "text-orange-500" : "text-green-600"}>{m} %</span><span className="block text-[10px] text-muted">ratio matière {100 - m} %</span></Td><Td>{p.kitchenStation?.name ?? "—"}</Td><Td>{p.modifierGroups.length || "—"}</Td>
                <Td><button onClick={(e) => { e.stopPropagation(); act(() => api.post(`/api/products/${p.id}/availability`, { isAvailable: !p.isAvailable }), { invalidate: [["products"], ["pos-catalog"]] }); }} className={`touch rounded-md px-2 py-0.5 text-xs font-bold ${p.isAvailable ? "bg-green-500/15 text-green-600" : "bg-red-500/15 text-red-600"}`}>{p.isAvailable ? "Disponible" : "Rupture"}</button></Td>
                <Td>{can("catalog.manage") ? <button onClick={(e) => { e.stopPropagation(); if (confirm(`Supprimer / archiver « ${p.name} » ?`)) act(() => api.delete(`/api/products/${p.id}`), { success: "Produit supprimé", invalidate: [["products"], ["pos-catalog"]] }); }} className="text-xs font-semibold text-red-600">Supprimer</button> : null}</Td>
              </Tr>
            );
          })}
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier le produit" : "Nouveau produit"} size="xl" footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEdit(null)}>Annuler</Button><Button loading={saving} disabled={!f?.name || f.priceTtc === ""} onClick={save}>Enregistrer</Button></div>}>
        {f ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Nom" className="md:col-span-2"><Input value={f.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Description" className="md:col-span-2"><Textarea value={f.description} onChange={(e) => set({ description: e.target.value })} /></Field>
            <Field label="Catégorie"><Select value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}><option value="">—</option>{categories.data?.map((c) => <option key={c.id} value={c.id}>{c.parentId ? "  ↳ " : ""}{c.name}</option>)}</Select></Field>
            <Field label="Poste cuisine / imprimante"><Select value={f.kitchenStationId} onChange={(e) => set({ kitchenStationId: e.target.value })}><option value="">—</option>{stations.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
            <Field label="Prix TTC"><Input type="number" min={0} value={f.priceTtc} onChange={(e) => set({ priceTtc: e.target.value })} /></Field>
            <Field label="TVA"><Select value={f.taxRateId} onChange={(e) => set({ taxRateId: e.target.value })}><option value="">Aucune (0 %)</option>{taxRates.data?.map((t) => <option key={t.id} value={t.id}>{t.name} — {formatBps(t.rateBps)}</option>)}</Select></Field>
            <Field label="Coût matière" hint={margin !== null ? `Marge brute ${margin} % · ratio matière ${Math.round((100 - margin) * 10) / 10} %` : undefined}><Input type="number" min={0} value={f.costPrice} onChange={(e) => set({ costPrice: e.target.value })} /></Field>
            <Field label="Couleur (hex, facultatif)"><Input value={f.color} onChange={(e) => set({ color: e.target.value })} placeholder="#F97316" /></Field>
            <Field label="Référence / SKU"><Input value={f.sku} onChange={(e) => set({ sku: e.target.value })} /></Field>
            <Field label="Code-barres"><Input value={f.barcode} onChange={(e) => set({ barcode: e.target.value })} /></Field>
            <div className="md:col-span-2"><PhotoField value={f.imageUrl} onChange={(v) => set({ imageUrl: v })} label="Photo du plat" /></div>
            <div className="flex flex-wrap gap-4 md:col-span-2"><Toggle checked={f.isAvailable} onChange={(v) => set({ isAvailable: v })} label="Disponible" /><Toggle checked={f.isActive} onChange={(v) => set({ isActive: v })} label="Actif (visible)" /><Toggle checked={f.trackStock} onChange={(v) => set({ trackStock: v })} label="Suivre le stock produit" /></div>
            {f.trackStock ? <><Field label="Stock actuel"><Input type="number" value={f.stockQty} onChange={(e) => set({ stockQty: e.target.value })} /></Field><Field label="Stock minimum"><Input type="number" value={f.stockMin} onChange={(e) => set({ stockMin: e.target.value })} /></Field></> : null}
            <div className="md:col-span-2">
              <div className="mb-1 flex items-center justify-between"><span className="text-xs font-semibold uppercase text-muted">Horaires de disponibilité</span><Toggle checked={!!f.availability} onChange={(v) => set({ availability: v ? { days: [1, 2, 3, 4, 5, 6, 7], from: "11:00", to: "14:30" } : null })} label={f.availability ? "Limité" : "Toujours"} /></div>
              {f.availability ? <div className="flex flex-wrap items-center gap-2"><div className="flex gap-1">{DAYS.map((d, i) => <button key={d} type="button" onClick={() => set({ availability: { ...f.availability!, days: f.availability!.days.includes(i + 1) ? f.availability!.days.filter((x) => x !== i + 1) : [...f.availability!.days, i + 1] } })} className={`h-9 w-11 rounded-lg text-xs font-bold ${f.availability!.days.includes(i + 1) ? "bg-lagon-600 text-white" : "surface-2"}`}>{d}</button>)}</div><Input type="time" value={f.availability.from} onChange={(e) => set({ availability: { ...f.availability!, from: e.target.value } })} className="w-32" /><span>→</span><Input type="time" value={f.availability.to} onChange={(e) => set({ availability: { ...f.availability!, to: e.target.value } })} className="w-32" /></div> : null}
            </div>
            <div className="md:col-span-2">
              <p className="mb-1 text-xs font-semibold uppercase text-muted">Variantes (tailles)</p>
              {f.variants.map((v, i) => <div key={i} className="mb-1 flex gap-2"><Input placeholder="Nom (ex. 50 cl)" value={v.name} onChange={(e) => set({ variants: f.variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /><Input type="number" placeholder="Prix TTC" value={v.priceTtc} onChange={(e) => set({ variants: f.variants.map((x, j) => (j === i ? { ...x, priceTtc: e.target.value } : x)) })} className="w-36" /><Button variant="ghost" onClick={() => set({ variants: f.variants.filter((_, j) => j !== i) })}>✕</Button></div>)}
              <Button size="sm" variant="outline" onClick={() => set({ variants: [...f.variants, { name: "", priceTtc: f.priceTtc }] })}>+ Variante</Button>
            </div>
            <div className="md:col-span-2">
              <p className="mb-1 text-xs font-semibold uppercase text-muted">Groupes d&apos;options</p>
              <div className="flex flex-wrap gap-2">{groups.data?.map((g) => { const on = f.modifierGroupIds.includes(g.id); return <button key={g.id} type="button" onClick={() => set({ modifierGroupIds: on ? f.modifierGroupIds.filter((x) => x !== g.id) : [...f.modifierGroupIds, g.id] })} className={`touch h-10 rounded-lg px-3 text-sm font-semibold ${on ? "bg-lagon-600 text-white" : "surface-2"}`}>{g.name} <span className="opacity-70">({g.modifiers.length})</span></button>; })}{groups.data?.length === 0 ? <span className="text-sm text-muted">Créez d&apos;abord des groupes dans l&apos;onglet Options.</span> : null}</div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
