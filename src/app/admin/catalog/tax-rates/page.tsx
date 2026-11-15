"use client";

import { useState } from "react";
import { Palmtree } from "lucide-react";
import { api } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { formatBps } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Toggle } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { CatalogTabs } from "@/components/admin/catalog-tabs";
import type { TaxRate } from "@/generated/prisma/client";
import { ISLANDS_PRESET, suggestKeepRate } from "@/lib/tax-presets";

type Category = { id: string; name: string; color: string; _count: { products: number } };
type SwitchForm = { name: string; pct: string; keep: string[] | null }; // null : catégories proposées (sucré, alcool)

export default function TaxRatesPage() {
  const act = useAction();
  const { toast } = useToast();
  const q = useList<TaxRate[]>(["tax-rates"], "/api/tax-rates");
  const [edit, setEdit] = useState<{ id?: string; name: string; pct: string; isDefault: boolean; isActive: boolean } | null>(null);
  const [sw, setSw] = useState<SwitchForm | null>(null);
  const cats = useList<Category[]>(["categories"], "/api/categories", !!sw);
  const openSwitch = () => setSw({ name: ISLANDS_PRESET.name, pct: ISLANDS_PRESET.pct, keep: null });
  const keepList = sw?.keep ?? (cats.data ?? []).filter((c) => suggestKeepRate(c.name)).map((c) => c.id);
  const applySwitch = async () => {
    if (!sw) return;
    const r = await act(() => api.post<{ products: number; menus: number; keptProducts: number }>("/api/tax-rates/switch", { name: sw.name, rateBps: Math.round(Number(sw.pct.replace(",", ".")) * 100), keepCategoryIds: keepList, makeDefault: true }), { invalidate: [["tax-rates"], ["pos-catalog"], ["products"]] });
    if (r) {
      setSw(null);
      toast(`${r.products} produit${r.products > 1 ? "s" : ""}${r.menus ? ` et ${r.menus} formule${r.menus > 1 ? "s" : ""}` : ""} à ${sw.pct} %${r.keptProducts ? ` · ${r.keptProducts} gardé${r.keptProducts > 1 ? "s" : ""} au taux d'origine` : ""}. Les ventes déjà faites ne changent pas.`, "success");
    }
  };
  const save = async () => {
    if (!edit) return;
    const body = { name: edit.name, rateBps: Math.round(Number(edit.pct.replace(",", ".")) * 100), isDefault: edit.isDefault, isActive: edit.isActive };
    const r = await act(() => (edit.id ? api.patch(`/api/tax-rates/${edit.id}`, body) : api.post("/api/tax-rates", body)), { success: "Taux enregistré", invalidate: [["tax-rates"], ["pos-catalog"], ["products"]] });
    if (r) setEdit(null);
  };
  return (
    <div>
      <PageHeader title="Catalogue" subtitle="Moteur de TVA configurable : aucun taux n'est figé dans le code. Les tickets ventilent HT / TVA par taux / TTC." action={<Button onClick={() => setEdit({ name: "", pct: "", isDefault: false, isActive: true })}>Nouveau taux</Button>} />
      <CatalogTabs />
      <section className="card mb-4 flex flex-wrap items-center gap-3 p-4 text-sm" data-testid="islands-card">
        <Palmtree className="h-6 w-6 shrink-0 text-lagon-600" />
        <p className="min-w-0 flex-1"><b>Changement de taux, par exemple TVA des îles à 1 %</b><span className="block text-muted">Passez toute la carte au nouveau taux en une fois, en gardant le taux actuel pour les catégories exclues (produits sucrés, alcool…). Les ventes déjà faites gardent leur taux. Pour un seul taux, touchez simplement « Modifier » dans la liste.</span></p>
        <Button variant="secondary" onClick={openSwitch} data-testid="islands-open">Changer le taux de la carte</Button>
      </section>
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Nom", "Taux", "Par défaut", "Statut", ""]}>
          {q.data?.map((t) => (
            <Tr key={t.id}><Td className="font-semibold">{t.name}</Td><Td className="font-mono">{formatBps(t.rateBps)}</Td><Td>{t.isDefault ? <Badge color="teal">défaut</Badge> : ""}</Td><Td>{t.isActive ? "Actif" : "Inactif"}</Td>
              <Td className="space-x-3"><button onClick={() => setEdit({ id: t.id, name: t.name, pct: String(t.rateBps / 100), isDefault: t.isDefault, isActive: t.isActive })} className="text-xs font-semibold text-lagon-600">Modifier</button><button onClick={() => confirm(`Supprimer « ${t.name} » ?`) && act(() => api.delete(`/api/tax-rates/${t.id}`), { success: "Supprimé", invalidate: [["tax-rates"]] })} className="text-xs font-semibold text-red-600">Supprimer</button></Td></Tr>
          ))}
        </Table>
      )}
      <Modal open={!!sw} onClose={() => setSw(null)} title="Changer le taux de toute la carte" size="md" footer={<Button className="w-full" disabled={!sw?.name || sw.pct === "" || cats.isLoading || Number.isNaN(Number(sw.pct.replace(",", ".")))} onClick={applySwitch} data-testid="islands-apply">Appliquer {sw?.pct ? `${sw.pct} %` : ""} à la carte</Button>}>
        {sw ? <div className="space-y-3">
          <div className="grid grid-cols-[1fr_7rem] gap-2"><Field label="Nom du taux"><Input value={sw.name} onChange={(e) => setSw({ ...sw, name: e.target.value })} /></Field><Field label="Taux (%)"><Input inputMode="decimal" value={sw.pct} onChange={(e) => setSw({ ...sw, pct: e.target.value })} data-testid="islands-pct" /></Field></div>
          <div>
            <p className="mb-1.5 text-sm font-semibold">Garder le taux actuel pour ces catégories</p>
            <p className="mb-2 text-xs text-muted">Cochez les catégories exclues du nouveau taux (sucré, alcool…). Nous avons pré-coché celles dont le nom s&apos;en approche : vérifiez.</p>
            {cats.isLoading ? <Spinner /> : (
              <ul className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                {cats.data?.map((c) => { const on = keepList.includes(c.id); return (
                  <li key={c.id}><label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:surface-2"><input type="checkbox" checked={on} onChange={() => setSw({ ...sw, keep: on ? keepList.filter((x) => x !== c.id) : [...keepList, c.id] })} data-testid="islands-keep" /><span className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} /><span className="flex-1">{c.name}</span><span className="text-xs text-muted">{c._count.products} produit{c._count.products > 1 ? "s" : ""}</span></label></li>
                ); })}
              </ul>
            )}
          </div>
          <p className="text-xs text-muted">Les produits exonérés (0 %) ne bougent pas. Le nouveau taux devient le taux par défaut des nouveaux produits. Un produit précis se règle ensuite dans Produits, colonne TVA.</p>
        </div> : null}
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier le taux" : "Nouveau taux de TVA"} size="sm" footer={<Button className="w-full" disabled={!edit?.name || edit.pct === ""} onClick={save}>Enregistrer</Button>}>
        {edit ? <div className="space-y-3"><Field label="Nom"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="TVA restauration" /></Field><Field label="Taux (%)" hint="0 pour un article exonéré"><Input value={edit.pct} onChange={(e) => setEdit({ ...edit, pct: e.target.value })} placeholder="13" /></Field><Toggle checked={edit.isDefault} onChange={(v) => setEdit({ ...edit, isDefault: v })} label="Taux par défaut des nouveaux produits" /><Toggle checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Actif" /></div> : null}
      </Modal>
    </div>
  );
}
