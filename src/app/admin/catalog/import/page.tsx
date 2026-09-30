"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/field";
import { PageHeader, Table, Tr, Td, useAction } from "@/components/admin/common";
import { CatalogTabs } from "@/components/admin/catalog-tabs";

const TARGETS = [["category", "Catégorie *"], ["name", "Produit *"], ["description", "Description"], ["priceTtc", "Prix TTC *"], ["taxRateBps", "TVA (%)"], ["costPrice", "Coût"], ["sku", "Référence"], ["isAvailable", "Disponible"], ["", "— ignorer —"]] as const;

/** Analyse CSV simple (séparateur ; ou , ou tabulation, guillemets). */
function parseCsv(text: string): string[][] {
  const sep = text.includes("\t") ? "\t" : (text.split("\n")[0]?.split(";").length ?? 0) > (text.split("\n")[0]?.split(",").length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === sep && !q) { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells.map((c) => c.trim()));
  }
  return rows;
}

export default function ImportPage() {
  const act = useAction();
  const [text, setText] = useState("");
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [result, setResult] = useState<{ createdCount: number; updatedCount: number; errors: { row: number; message: string }[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const rows = useMemo(() => parseCsv(text), [text]);
  const header = rows[0] ?? [];
  const body = rows.slice(1);

  const autoMap = () => {
    const m: Record<number, string> = {};
    header.forEach((h, i) => {
      const k = h.toLowerCase();
      if (k.includes("cat")) m[i] = "category"; else if (k.includes("produit") || k === "nom" || k.includes("name")) m[i] = "name"; else if (k.includes("desc")) m[i] = "description";
      else if (k.includes("prix") || k.includes("price")) m[i] = "priceTtc"; else if (k.includes("tva") || k.includes("tax")) m[i] = "taxRateBps"; else if (k.includes("co") && (k.includes("ût") || k.includes("ut") || k.includes("cost"))) m[i] = "costPrice";
      else if (k.includes("ref") || k.includes("sku")) m[i] = "sku"; else if (k.includes("dispo")) m[i] = "isAvailable";
    });
    setMapping(m);
  };
  const onFile = async (f: File | null) => { if (!f) return; setText(await f.text()); setResult(null); setTimeout(autoMap, 0); };
  const num = (v: string) => Number(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
  // Prix en F CFP (sans centimes) : « 1.500 », « 1,500 » et « 1 500 » valent 1 500 F
  const money = (v: string) => { const t = String(v).replace(/[\s\u00a0\u202f]/g, "").replace(/[^\d.,-]/g, ""); return /[.,]\d{3}$/.test(t) || /[.,]\d{3}[.,]/.test(t) ? Number(t.replace(/[.,]/g, "")) : Number(t.replace(",", ".")); };
  // TVA : « 13 », « 13 % » ou « 0,13 » valent 13 %
  const rate = (v: string) => { const x = num(v); return x > 0 && x < 1 ? x * 100 : x; };
  const build = () => body.map((r) => {
    const o: Record<string, unknown> = {};
    header.forEach((_, i) => { const t = mapping[i]; if (!t) return; const v = r[i] ?? ""; if (t === "priceTtc" || t === "costPrice") o[t] = Math.round(money(v) || 0); else if (t === "taxRateBps") o[t] = v === "" ? null : Math.round(rate(v) * 100); else if (t === "isAvailable") o[t] = !/^(non|no|0|false|faux)$/i.test(v); else o[t] = v; });
    return o;
  }).filter((o) => o.name && o.category);
  const preview = build();
  const submit = async () => { setLoading(true); const r = await act(() => api.post<typeof result>("/api/products/import", { rows: preview }), { success: "Import terminé", invalidate: [["products"], ["categories"], ["pos-catalog"], ["tax-rates"]] }); setLoading(false); if (r) setResult(r); };

  return (
    <div>
      <PageHeader title="Catalogue" subtitle="Import CSV / Excel (exporté en CSV) avec correspondance des colonnes" />
      <CatalogTabs />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <input type="file" accept=".csv,.txt,.tsv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} className="block text-sm" />
          <p className="text-xs text-muted">Ou collez le contenu CSV (séparateur ; , ou tabulation). Colonnes attendues : Catégorie, Produit, Description, Prix, TVA, Coût, Référence, Disponible.</p>
          <Textarea value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} placeholder={"Catégorie;Produit;Description;Prix;TVA;Coût;Référence;Disponible\nPlats;Burger Bacon;;2100;13;630;PLA-001;oui"} className="min-h-[160px] font-mono text-xs" />
          <Button variant="secondary" onClick={autoMap} disabled={header.length === 0}>Détecter les colonnes</Button>
        </div>
        <div>
          {header.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase text-muted">Correspondance des colonnes</p>
              {header.map((h, i) => <div key={i} className="flex items-center gap-2"><span className="w-40 truncate text-sm font-semibold">{h || `Colonne ${i + 1}`}</span><Select value={mapping[i] ?? ""} onChange={(e) => setMapping({ ...mapping, [i]: e.target.value })} className="flex-1">{TARGETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></div>)}
              <p className="text-sm">{preview.length} ligne{preview.length > 1 ? "s" : ""} prête{preview.length > 1 ? "s" : ""} à importer</p>
              <Button size="lg" loading={loading} disabled={preview.length === 0} onClick={submit}>Importer {preview.length} produit{preview.length > 1 ? "s" : ""}</Button>
            </div>
          ) : null}
          {result ? <div className="mt-3 rounded-xl surface-2 p-3 text-sm"><p><strong>{result.createdCount}</strong> créés · <strong>{result.updatedCount}</strong> mis à jour (par référence) · <strong>{result.errors.length}</strong> erreurs</p>{result.errors.map((e) => <p key={e.row} className="text-red-600">Ligne {e.row} : {e.message}</p>)}</div> : null}
        </div>
      </div>
      {preview.length > 0 ? <div className="mt-4"><Table head={["Catégorie", "Produit", "Prix", "TVA", "Coût", "Réf."]}>{preview.slice(0, 20).map((r, i) => <Tr key={i}><Td>{String(r.category)}</Td><Td>{String(r.name)}</Td><Td>{String(r.priceTtc)}</Td><Td>{r.taxRateBps === null || r.taxRateBps === undefined ? "défaut" : `${Number(r.taxRateBps) / 100} %`}</Td><Td>{String(r.costPrice ?? 0)}</Td><Td>{String(r.sku ?? "")}</Td></Tr>)}</Table>{preview.length > 20 ? <p className="mt-1 text-xs text-muted">… et {preview.length - 20} autres</p> : null}</div> : null}
    </div>
  );
}
