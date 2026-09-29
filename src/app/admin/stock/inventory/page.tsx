"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { StockTabs } from "@/components/admin/stock-tabs";
import { fmtQty, type Ingredient } from "@/components/admin/stock-types";

/** Inventaire : saisir le comptage réel ; l'écart est enregistré et le stock remplacé. */
export default function InventoryPage() {
  const { can } = useSession();
  const act = useAction();
  const q = useList<Ingredient[]>(["stock", "ingredients"], "/api/stock/ingredients");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<{ lines: { name: string; unit: string; before: number; counted: number; diff: number; value: number }[]; totalValue: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const rows = useMemo(() => (q.data ?? []).filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase())), [q.data, search]);
  const filled = (q.data ?? []).filter((i) => counts[i.id] !== undefined && counts[i.id] !== "");
  const diffValue = filled.reduce((a, i) => a + Math.round((Number(counts[i.id]) - i.stockQty) * i.avgCost), 0);

  const submit = async () => {
    setSaving(true);
    const r = await act(() => api.post<{ lines: { name: string; unit: string; before: number; counted: number; diff: number; value: number }[]; totalValue: number }>("/api/stock/inventory", { lines: filled.map((i) => ({ ingredientId: i.id, countedQty: Number(counts[i.id]) })), reason: "Inventaire" }), { success: "Inventaire enregistré", invalidate: [["stock"], ["pos-catalog"]] });
    setSaving(false);
    if (r) { setResult(r); setCounts({}); }
  };

  return (
    <div>
      <PageHeader title="Inventaire" subtitle="Comptez vos ingrédients : l'écart avec le stock théorique est tracé et valorisé" action={can("stock.manage") ? <Button disabled={filled.length === 0} loading={saving} onClick={submit}>Valider {filled.length ? `(${filled.length})` : ""}</Button> : null} />
      <StockTabs />
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className="w-56!" />
        {filled.length ? <span className={`text-sm font-semibold ${diffValue < 0 ? "text-red-600" : "text-green-600"}`}>Écart valorisé : {diffValue > 0 ? "+" : ""}<Money amount={diffValue} /></span> : <span className="text-sm text-muted">Laissez vide les ingrédients non comptés : ils ne seront pas modifiés.</span>}
      </div>
      {result ? (
        <div className="card mb-4 p-4">
          <p className="mb-2 font-bold">Inventaire enregistré · écart total {result.totalValue > 0 ? "+" : ""}<Money amount={result.totalValue} /></p>
          <div className="flex flex-wrap gap-2 text-xs">{result.lines.filter((l) => l.diff !== 0).map((l) => <span key={l.name} className={`rounded-lg px-2 py-1 ${l.diff < 0 ? "bg-red-500/10 text-red-700" : "bg-green-500/10 text-green-700"}`}>{l.name} : {l.diff > 0 ? "+" : ""}{fmtQty(l.diff, l.unit)}</span>)}{result.lines.every((l) => l.diff === 0) ? <span className="text-muted">Aucun écart</span> : null}</div>
          <button onClick={() => setResult(null)} className="mt-2 text-xs font-semibold text-lagon-600">Fermer</button>
        </div>
      ) : null}
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Ingrédient", "Stock théorique", "Compté", "Écart", "Valeur écart"]}>
          {rows.map((i) => {
            const c = counts[i.id];
            const diff = c !== undefined && c !== "" ? Number(c) - i.stockQty : null;
            return (
              <Tr key={i.id}>
                <Td><span className="font-semibold">{i.name}</span><span className="block text-xs text-muted">{i.unit}</span></Td>
                <Td className="tabular-nums">{fmtQty(i.stockQty, i.unit)}</Td>
                <Td><Input type="number" step="0.001" inputMode="decimal" value={c ?? ""} onChange={(e) => setCounts({ ...counts, [i.id]: e.target.value })} placeholder={fmtQty(i.stockQty)} className="w-32!" disabled={!can("stock.manage")} /></Td>
                <Td className={`font-semibold tabular-nums ${diff === null ? "text-muted" : diff < 0 ? "text-red-600" : diff > 0 ? "text-green-600" : ""}`}>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${fmtQty(Math.round(diff * 1000) / 1000, i.unit)}`}</Td>
                <Td className="tabular-nums">{diff === null ? "—" : <Money amount={Math.round(diff * i.avgCost)} />}</Td>
              </Tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
