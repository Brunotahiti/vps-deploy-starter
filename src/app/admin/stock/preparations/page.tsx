"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChefHat, FlaskConical, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";
import { Spinner, Card, Badge } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { PageHeader, useAction, useList } from "@/components/admin/common";
import { StockTabs } from "@/components/admin/stock-tabs";
import { UNIT_OPTIONS, fmtQty, type Ingredient, type Preparation } from "@/components/admin/stock-types";

type Line = { ingredientId: string; quantity: string };
type NewForm = { name: string; unit: string; yieldQty: string; stockMin: string };

/**
 * Préparations maison : une sauce, une marinade, un fond… fabriqués à partir de plusieurs ingrédients.
 * On définit la composition d'un lot et la quantité obtenue ; « Produire » sort les composants du stock
 * et entre la préparation à son coût réel. Les recettes des plats l'utilisent ensuite comme un ingrédient.
 */
export default function PreparationsPage() {
  const { can } = useSession();
  const act = useAction();
  const manage = can("stock.manage");
  const preps = useList<Preparation[]>(["stock", "preparations"], "/api/stock/preparations");
  const ingredients = useList<Ingredient[]>(["stock", "ingredients"], "/api/stock/ingredients");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<NewForm | null>(null);
  const prep = useQuery({ queryKey: ["stock", "preparation", selected], queryFn: () => api.get<Preparation>(`/api/stock/preparations/${selected}`), enabled: !!selected });

  const create = async () => {
    if (!creating) return;
    const r = await act(() => api.post<{ id: string }>("/api/stock/ingredients", { name: creating.name, unit: creating.unit, isPreparation: true, yieldQty: Number(creating.yieldQty || 1), stockMin: Number(creating.stockMin || 0) }), { success: "Préparation créée : définissez sa composition", invalidate: [["stock"]] });
    if (r) { setCreating(null); setSelected(r.id); }
  };

  return (
    <div>
      <PageHeader title="Préparations maison" subtitle="Plusieurs ingrédients → une sauce, une marinade, un fond : composition d'un lot, coût réel, production et stock" action={manage ? <Button onClick={() => setCreating({ name: "", unit: "l", yieldQty: "1", stockMin: "0" })} data-testid="prep-new"><Plus className="h-4 w-4" />Nouvelle préparation</Button> : null} />
      <StockTabs />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card title="Préparations">
          {preps.isLoading ? <Spinner /> : (preps.data ?? []).length === 0 ? (
            <div className="py-6 text-center text-sm text-muted">
              <FlaskConical className="mx-auto mb-2 h-8 w-8" />
              <p className="font-semibold text-[var(--text)]">Aucune préparation</p>
              <p className="mt-1">Exemple : « Sauce burger » = 500 g de mayonnaise + 200 g de ketchup + 50 g d&apos;oignon → 0,75 l. À la production, les trois sortent du stock et la sauce y entre au coût exact.</p>
            </div>
          ) : (
            <div className="max-h-[65vh] space-y-1 overflow-y-auto">
              {preps.data!.map((p) => (
                <button key={p.id} onClick={() => setSelected(p.id)} className={`touch flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${selected === p.id ? "bg-lagon-600 text-white" : "hover:surface-2"}`} data-testid="prep-row">
                  <span className="min-w-0"><span className="block truncate font-semibold">{p.name}</span><span className={`block text-xs ${selected === p.id ? "opacity-80" : "text-muted"}`}>{p.lines.length ? `${p.lines.length} composant${p.lines.length > 1 ? "s" : ""} · lot de ${fmtQty(p.yieldQty, p.unit)}` : "composition à définir"}</span></span>
                  <span className={`shrink-0 text-right text-xs font-bold tabular-nums ${selected === p.id ? "" : p.stockQty <= 0 ? "text-red-600" : p.stockQty <= p.stockMin ? "text-orange-600" : ""}`}>{fmtQty(p.stockQty, p.unit)}</span>
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card title={prep.data ? `${prep.data.name}` : "Composition"}>
          {!selected ? <p className="py-8 text-center text-sm text-muted">Choisissez une préparation à gauche, ou créez-en une.</p> : prep.isLoading || !prep.data ? <div className="flex justify-center py-8"><Spinner /></div> : (
            <PreparationEditor key={`${prep.data.id}-${prep.dataUpdatedAt}`} prep={prep.data} ingredients={(ingredients.data ?? []).filter((i) => i.id !== prep.data!.id)} canManage={manage}
              onSave={(lines, yieldQty) => act(() => api.put(`/api/stock/preparations/${selected}`, { lines, yieldQty }), { success: "Composition enregistrée", invalidate: [["stock"]] })}
              onProduce={(batches, reason) => act(() => api.post<{ produced: number; unitCost: number }>(`/api/stock/preparations/${selected}/produce`, { batches, reason: reason || null }), { invalidate: [["stock"], ["pos-catalog"], ["products"]] })} />
          )}
        </Card>
      </div>

      <Modal open={!!creating} onClose={() => setCreating(null)} title="Nouvelle préparation" size="sm" footer={<Button className="w-full" disabled={!creating?.name || !(Number(creating?.yieldQty) > 0)} onClick={create} data-testid="prep-create">Créer</Button>}>
        {creating ? <div className="space-y-3">
          <Field label="Nom"><Input value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} placeholder="Sauce burger, Marinade poisson cru, Fond de volaille…" autoFocus data-testid="prep-name" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unité de la préparation"><Select value={creating.unit} onChange={(e) => setCreating({ ...creating, unit: e.target.value })}>{UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}</Select></Field>
            <Field label="Quantité obtenue par lot" hint="ex. 2 pour 2 l de sauce"><Input type="number" step="0.001" value={creating.yieldQty} onChange={(e) => setCreating({ ...creating, yieldQty: e.target.value })} data-testid="prep-yield" /></Field>
          </div>
          <Field label="Seuil d'alerte (stock de préparation)"><Input type="number" step="0.001" value={creating.stockMin} onChange={(e) => setCreating({ ...creating, stockMin: e.target.value })} /></Field>
          <p className="text-xs text-muted">La préparation apparaît ensuite dans la liste des ingrédients : utilisez-la dans les recettes de vos plats.</p>
        </div> : null}
      </Modal>
    </div>
  );
}

function PreparationEditor({ prep, ingredients, canManage, onSave, onProduce }: { prep: Preparation; ingredients: Ingredient[]; canManage: boolean; onSave: (lines: { ingredientId: string; quantity: number }[], yieldQty: number) => Promise<unknown>; onProduce: (batches: number, reason: string) => Promise<{ produced: number; unitCost: number } | null> }) {
  const [lines, setLines] = useState<Line[]>(() => prep.lines.length ? prep.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity) })) : [{ ingredientId: "", quantity: "" }]);
  const [yieldQty, setYieldQty] = useState(String(prep.yieldQty));
  const [batches, setBatches] = useState("1");
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<{ produced: number; unitCost: number } | null>(null);
  const ing = (id: string) => ingredients.find((i) => i.id === id);
  const batchCost = lines.reduce((a, l) => a + Number(l.quantity || 0) * (ing(l.ingredientId)?.avgCost ?? 0), 0);
  const y = Number(yieldQty || 0);
  const unitCost = y > 0 ? Math.round(batchCost / y) : 0;
  const nb = Number(batches || 0);
  const valid = lines.filter((l) => l.ingredientId && Number(l.quantity) > 0);
  const dirty = JSON.stringify(valid.map((l) => [l.ingredientId, Number(l.quantity)])) !== JSON.stringify(prep.lines.map((l) => [l.ingredientId, l.quantity])) || y !== prep.yieldQty;
  const produce = async () => { const r = await onProduce(nb, reason); if (r) { setDone(r); setReason(""); } };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-xl surface-2 p-3"><p className="text-[11px] font-bold uppercase text-muted">En stock</p><p className={`text-lg font-extrabold ${prep.stockQty <= 0 ? "text-red-600" : ""}`}>{fmtQty(prep.stockQty, prep.unit)}</p></div>
        <div className="rounded-xl surface-2 p-3"><p className="text-[11px] font-bold uppercase text-muted">Coût d&apos;un lot</p><p className="text-lg font-extrabold"><Money amount={Math.round(batchCost)} /></p></div>
        <div className="rounded-xl surface-2 p-3"><p className="text-[11px] font-bold uppercase text-muted">Coût par {prep.unit}</p><p className="text-lg font-extrabold"><Money amount={unitCost} /></p><p className="text-[11px] text-muted">moyen actuel <Money amount={prep.avgCost} /></p></div>
        <div className="rounded-xl surface-2 p-3"><p className="text-[11px] font-bold uppercase text-muted">Lots réalisables</p><p className={`text-lg font-extrabold ${prep.producibleBatches === 0 && prep.lines.length ? "text-orange-600" : ""}`}>{prep.lines.length ? prep.producibleBatches : "—"}</p><p className="text-[11px] text-muted">avec le stock actuel</p></div>
      </div>

      <div>
        <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted"><FlaskConical className="h-4 w-4" />Composition d&apos;un lot</p>
        <div className="space-y-2">
          {lines.map((l, i) => { const g = ing(l.ingredientId); return (
            <div key={i} className="grid grid-cols-[1fr_5rem_auto] items-center gap-2 sm:grid-cols-[1fr_6rem_3rem_6rem_minmax(7rem,auto)_2.5rem]">
              <Select value={l.ingredientId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value } : x)))} disabled={!canManage} data-testid="prep-line-ingredient"><option value="">— ingrédient —</option>{ingredients.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit}){x.isPreparation ? " · préparation" : ""}</option>)}</Select>
              <Input type="number" step="0.001" inputMode="decimal" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} placeholder="Qté" disabled={!canManage} data-testid="prep-line-qty" />
              <span className="hidden text-xs text-muted sm:block">{g?.unit ?? ""}</span>
              <span className="hidden text-right text-sm font-semibold sm:block"><Money amount={Math.round(Number(l.quantity || 0) * (g?.avgCost ?? 0))} /></span>
              <span className="hidden items-center gap-1 text-xs text-muted sm:flex">{g ? (g.stockQty <= 0 ? <Badge color="red">rupture</Badge> : <span>stock {fmtQty(g.stockQty, g.unit)}</span>) : null}</span>
              {canManage ? <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</Button> : <span />}
            </div>
          ); })}
          {canManage ? <Button size="sm" variant="outline" onClick={() => setLines([...lines, { ingredientId: "", quantity: "" }])}>+ Ingrédient</Button> : null}
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-line pt-3">
          <Field label={`Quantité obtenue par lot (${prep.unit})`}><Input type="number" step="0.001" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} disabled={!canManage} className="w-36!" data-testid="prep-yield-edit" /></Field>
          {canManage ? <Button disabled={!dirty || !(y > 0)} onClick={() => onSave(valid.map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity) })), y)} data-testid="prep-save">Enregistrer la composition</Button> : null}
        </div>
      </div>

      {canManage && prep.lines.length ? (
        <div className="rounded-2xl border border-lagon-500/30 bg-lagon-500/5 p-4">
          <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-lagon-700 dark:text-lagon-300"><ChefHat className="h-4 w-4" />Produire</p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Nombre de lots"><Input type="number" step="0.5" min="0.5" value={batches} onChange={(e) => setBatches(e.target.value)} className="w-28!" data-testid="prep-batches" /></Field>
            <Field label="Note (facultatif)" className="min-w-40 flex-1"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Service du soir…" /></Field>
            <Button disabled={!(nb > 0) || dirty} onClick={produce} data-testid="prep-produce">Produire {nb > 0 ? `→ ${fmtQty(prep.yieldQty * nb, prep.unit)}` : ""}</Button>
          </div>
          <p className="mt-2 text-xs text-muted">{dirty ? "Enregistrez d'abord la composition." : `Sort du stock : ${prep.lines.map((l) => `${fmtQty(l.quantity * (nb || 0), l.unit)} ${l.name}`).join(", ")} · coût ${nb > 0 ? Math.round(prep.batchCost * nb).toLocaleString("fr-FR") : 0} F. Un composant manquant passe en négatif plutôt que de bloquer la production.`}</p>
          {done ? <p className="mt-2 rounded-xl bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-700 dark:text-green-300" data-testid="prep-done">✓ {fmtQty(done.produced, prep.unit)} produits, au coût de <Money amount={done.unitCost} /> par {prep.unit}.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
