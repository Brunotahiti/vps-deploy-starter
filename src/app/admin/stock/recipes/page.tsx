"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input, Select, Toggle } from "@/components/ui/field";
import { Spinner, Card, Badge } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { PageHeader, useAction, useList } from "@/components/admin/common";
import { StockTabs } from "@/components/admin/stock-tabs";
import { fmtQty, type Ingredient, type Recipe } from "@/components/admin/stock-types";
import type { listProducts } from "@/server/services/catalog";

type Product = Awaited<ReturnType<typeof listProducts>>[number];
type Line = { ingredientId: string; quantity: string };

/** Recettes : ingrédients et quantités par produit ; coût matière calculé et marge. */
export default function RecipesPage() {
  const { can } = useSession();
  const act = useAction();
  const products = useList<Product[]>(["products"], "/api/products");
  const ingredients = useList<Ingredient[]>(["stock", "ingredients"], "/api/stock/ingredients");
  const [search, setSearch] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const recipe = useQuery({ queryKey: ["stock", "recipe", productId], queryFn: () => api.get<Recipe>(`/api/stock/recipes/${productId}`), enabled: !!productId });
  const list = useMemo(() => (products.data ?? []).filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase())), [products.data, search]);
  const withRecipe = new Set((products.data ?? []).filter((p) => p._count.recipeLines > 0).map((p) => p.id));

  return (
    <div>
      <PageHeader title="Recettes" subtitle="Ingrédients consommés par produit vendu — décrémentation automatique à l'envoi en cuisine" />
      <StockTabs />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card title="Produits">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className="mb-2" />
          <div className="max-h-[60vh] space-y-1 overflow-y-auto">
            {products.isLoading ? <Spinner /> : list.map((p) => <button key={p.id} onClick={() => setProductId(p.id)} className={`touch flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${productId === p.id ? "bg-lagon-600 text-white" : "hover:surface-2"}`}><span className="truncate font-semibold">{p.name}</span><span className="ml-2 shrink-0 text-xs opacity-80">{withRecipe.has(p.id) ? "✓" : ""}<Money amount={p.priceTtc} /></span></button>)}
          </div>
        </Card>
        <Card title={recipe.data ? `Recette — ${recipe.data.product.name}` : "Recette"}>
          {!productId ? <p className="py-8 text-center text-sm text-muted">Choisissez un produit à gauche.</p> : recipe.isLoading || !recipe.data ? <div className="flex justify-center py-8"><Spinner /></div> : (
            <RecipeEditor key={`${recipe.data.product.id}-${recipe.dataUpdatedAt}`} recipe={recipe.data} ingredients={ingredients.data ?? []} canManage={can("stock.manage")} onSave={(lines, applyCost) => act(() => api.put(`/api/stock/recipes/${productId}`, { lines, applyCost }), { success: "Recette enregistrée", invalidate: [["stock"], ["products"], ["pos-catalog"]] })} />
          )}
        </Card>
      </div>
    </div>
  );
}

function RecipeEditor({ recipe, ingredients, canManage, onSave }: { recipe: Recipe; ingredients: Ingredient[]; canManage: boolean; onSave: (lines: { ingredientId: string; quantity: number }[], applyCost: boolean) => Promise<unknown> }) {
  const [lines, setLines] = useState<Line[]>(() => recipe.lines.map((l) => ({ ingredientId: l.ingredientId, quantity: String(l.quantity) })));
  const [applyCost, setApplyCost] = useState(true);
  const ing = (id: string) => ingredients.find((i) => i.id === id);
  const cost = lines.reduce((a, l) => a + Number(l.quantity || 0) * (ing(l.ingredientId)?.avgCost ?? 0), 0);
  const priceHt = recipe.product.priceHt;
  const margin = priceHt > 0 ? Math.round(((priceHt - cost) / priceHt) * 1000) / 10 : null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="rounded-xl surface-2 p-3"><p className="text-[11px] font-bold uppercase text-muted">Prix HT</p><p className="text-lg font-extrabold"><Money amount={priceHt} /></p></div>
        <div className="rounded-xl surface-2 p-3"><p className="text-[11px] font-bold uppercase text-muted">Coût matière</p><p className="text-lg font-extrabold"><Money amount={Math.round(cost)} /></p></div>
        <div className="rounded-xl surface-2 p-3"><p className="text-[11px] font-bold uppercase text-muted">Marge brute</p><p className={`text-lg font-extrabold ${margin !== null && margin < 60 ? "text-orange-600" : "text-green-600"}`}>{margin !== null ? `${margin} %` : "—"}</p></div>
        <div className="rounded-xl surface-2 p-3"><p className="text-[11px] font-bold uppercase text-muted">Coût enregistré</p><p className="text-lg font-extrabold"><Money amount={recipe.product.costPrice} /></p></div>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => { const g = ing(l.ingredientId); return (
          <div key={i} className="grid grid-cols-[1fr_5rem_auto] items-center gap-2 sm:grid-cols-[1fr_6rem_3rem_6rem_minmax(7rem,auto)_2.5rem]">
            <Select value={l.ingredientId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value } : x)))} disabled={!canManage}><option value="">— ingrédient —</option>{ingredients.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</Select>
            <Input type="number" step="0.001" inputMode="decimal" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} placeholder="Qté" disabled={!canManage} />
            <span className="hidden text-xs text-muted sm:block">{g?.unit ?? ""}</span>
            <span className="hidden text-right text-sm font-semibold sm:block"><Money amount={Math.round(Number(l.quantity || 0) * (g?.avgCost ?? 0))} /></span>
            <span className="hidden items-center gap-1 text-xs text-muted sm:flex">{g && g.isCritical ? <Badge color="purple">critique</Badge> : null}{g && g.stockQty <= 0 ? <Badge color="red">rupture</Badge> : g ? <span>stock {fmtQty(g.stockQty, g.unit)}</span> : null}</span>
            {canManage ? <Button variant="ghost" size="sm" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</Button> : <span />}
          </div>
        ); })}
        {canManage ? <Button size="sm" variant="outline" onClick={() => setLines([...lines, { ingredientId: "", quantity: "" }])}>+ Ingrédient</Button> : null}
        {ingredients.length === 0 ? <p className="text-sm text-muted">Créez d&apos;abord des ingrédients dans l&apos;onglet Ingrédients.</p> : null}
      </div>
      {canManage ? <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"><Toggle checked={applyCost} onChange={setApplyCost} label="Mettre à jour le coût matière du produit avec cette recette" /><Button onClick={() => onSave(lines.filter((l) => l.ingredientId && Number(l.quantity) > 0).map((l) => ({ ingredientId: l.ingredientId, quantity: Number(l.quantity) })), applyCost)}>Enregistrer la recette</Button></div> : null}
    </div>
  );
}
