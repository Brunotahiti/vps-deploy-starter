"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, PackagePlus, Pencil, Plus, Trash2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea, Toggle } from "@/components/ui/field";
import { Card, Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { addDays, formatDateTime, localDay } from "@/lib/dates";
import type { BarSettings, HappyHour } from "@/lib/happy-hour";
import { CocktailCard } from "./pos-bar";
import { BAR_KIND_LABEL, doseLabel, stockLabel, type BarKind, type BarReport, type Bottle, type Cocktail } from "./types";

const DAYS = [["L", 1], ["M", 2], ["M", 3], ["J", 4], ["V", 5], ["S", 6], ["D", 0]] as const;
const DAY_NAMES = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const num = (v: string) => Number(v.replace(",", "."));

// ------------------------------------------------------------------ Happy hour
export function HappyHourSettings() {
  const act = useAction();
  const q = useQuery({ queryKey: ["bar", "settings"], queryFn: () => api.get<BarSettings>("/api/bar/settings") });
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api.get<{ id: string; name: string; color: string | null }[]>("/api/categories") });
  const drinks = useQuery({ queryKey: ["bar", "cocktails"], queryFn: () => api.get<Cocktail[]>("/api/bar/cocktails") });
  if (q.isLoading || cats.isLoading || drinks.isLoading || !q.data) return <Spinner />;
  return <HappyHourForm key={JSON.stringify(q.data)} initial={q.data.happyHours} categories={cats.data ?? []} drinks={(drinks.data ?? []).map((d) => ({ id: d.id, name: d.name }))} onSave={(happyHours) => act(() => api.put("/api/bar/settings", { happyHours }), { success: "Happy hour enregistré", invalidate: [["bar", "settings"]] })} />;
}

function HappyHourForm({ initial, categories, drinks, onSave }: { initial: HappyHour[]; categories: { id: string; name: string }[]; drinks: { id: string; name: string }[]; onSave: (h: HappyHour[]) => Promise<unknown> }) {
  const [list, setList] = useState<HappyHour[]>(initial);
  const [busy, setBusy] = useState(false);
  const add = () => setList([...list, { id: crypto.randomUUID().slice(0, 8), name: "Happy hour", days: [1, 2, 3, 4, 5, 6, 0], start: "17:00", end: "19:00", discountBps: 3000, categoryIds: [], productIds: [], enabled: true }]);
  const patch = (id: string, p: Partial<HappyHour>) => setList(list.map((h) => (h.id === id ? { ...h, ...p } : h)));
  const save = async () => { setBusy(true); await onSave(list); setBusy(false); };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Pendant un créneau, le prix des boissons choisies baisse tout seul à la caisse, sur le ticket et au bar. Un créneau qui passe minuit (22 h → 1 h) compte pour le jour où il commence.</p>
      {list.map((h) => (
        <section key={h.id} className="card space-y-3 p-4" data-testid="happy-hour">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-56 max-w-full"><Input value={h.name} onChange={(e) => patch(h.id, { name: e.target.value })} maxLength={40} aria-label="Nom du créneau" /></div>
            <Toggle checked={h.enabled} onChange={(v) => patch(h.id, { enabled: v })} label={h.enabled ? "Actif" : "En pause"} />
            <button type="button" onClick={() => setList(list.filter((x) => x.id !== h.id))} className="touch ml-auto flex h-10 w-10 items-center justify-center rounded-xl text-red-600 hover:bg-red-500/10" aria-label="Supprimer le créneau"><Trash2 className="h-4 w-4" /></button>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Jours"><div className="flex gap-1">{DAYS.map(([l, d]) => <button key={d} type="button" onClick={() => patch(h.id, { days: h.days.includes(d) ? h.days.filter((x) => x !== d) : [...h.days, d] })} aria-pressed={h.days.includes(d)} aria-label={DAY_NAMES[d]} className={`touch h-10 w-10 rounded-xl text-sm font-bold ${h.days.includes(d) ? "bg-lagon-600 text-white" : "surface-2 text-muted"}`}>{l}</button>)}</div></Field>
            <Field label="De" className="w-36"><Input type="time" value={h.start} onChange={(e) => patch(h.id, { start: e.target.value })} /></Field>
            <Field label="À" className="w-36"><Input type="time" value={h.end} onChange={(e) => patch(h.id, { end: e.target.value })} /></Field>
            <Field label="Réduction (%)" className="w-28"><Input inputMode="numeric" value={String(h.discountBps / 100)} onChange={(e) => patch(h.id, { discountBps: Math.round(Math.min(100, Math.max(0, num(e.target.value) || 0)) * 100) })} aria-label="Réduction en pourcentage" /></Field>
          </div>
          <Field label="Catégories entières">
            <div className="flex flex-wrap gap-1.5">{categories.map((c) => <button key={c.id} type="button" onClick={() => patch(h.id, { categoryIds: h.categoryIds.includes(c.id) ? h.categoryIds.filter((x) => x !== c.id) : [...h.categoryIds, c.id] })} aria-pressed={h.categoryIds.includes(c.id)} className={`touch h-9 rounded-full px-3 text-xs font-semibold ${h.categoryIds.includes(c.id) ? "bg-fuchsia-600 text-white" : "surface-2"}`}>{c.name}</button>)}</div>
          </Field>
          {drinks.length ? (
            <Field label="Ou boisson par boisson" hint="Pratique pour réduire les cocktails, bières et vins sans toucher à l'eau ni au café.">
              <div className="flex flex-wrap gap-1.5">{drinks.map((d) => <button key={d.id} type="button" onClick={() => patch(h.id, { productIds: h.productIds.includes(d.id) ? h.productIds.filter((x) => x !== d.id) : [...h.productIds, d.id] })} aria-pressed={h.productIds.includes(d.id)} className={`touch h-9 rounded-full px-3 text-xs font-semibold ${h.productIds.includes(d.id) ? "bg-fuchsia-600 text-white" : "surface-2"}`}>{d.name}</button>)}</div>
            </Field>
          ) : null}
        </section>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={add} data-testid="happy-hour-add"><Plus className="h-4 w-4" />Ajouter un créneau</Button>
        <Button onClick={save} loading={busy} data-testid="happy-hour-save">Enregistrer</Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Fiches cocktails
export function CocktailCards() {
  const q = useQuery({ queryKey: ["bar", "cocktails"], queryFn: () => api.get<Cocktail[]>("/api/bar/cocktails") });
  const cellar = useQuery({ queryKey: ["bar", "cellar"], queryFn: () => api.get<Bottle[]>("/api/bar/cellar") });
  const [editing, setEditing] = useState<Cocktail | null>(null);
  if (q.isLoading) return <Spinner />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Les boissons envoyées au bar. Une fiche donne au barman le verre, les doses, la garniture et la préparation ; chaque vente décompte les doses de la cave du bar.</p>
      <div className="card overflow-hidden">
        {(q.data ?? []).map((c) => (
          <button key={c.id} type="button" onClick={() => setEditing(c)} className="touch flex w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:surface-2" data-testid="cocktail-row">
            <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{c.name}</span><span className="block truncate text-xs text-muted">{c.doses.length ? c.doses.map((d) => `${doseLabel(d)} ${d.name}`).join(" · ") : c.hasCard ? "Fiche sans doses" : "Pas encore de fiche"}</span></span>
            {c.doses.length ? <span className="text-right text-xs text-muted">coût <Money amount={c.doseCost} /><br />prix <Money amount={c.priceTtc} /></span> : null}
            <Pencil className="h-4 w-4 shrink-0 text-muted" />
          </button>
        ))}
        {!q.data?.length ? <p className="px-4 py-8 text-center text-sm text-muted">Aucune boisson envoyée au bar dans votre carte.</p> : null}
      </div>
      {editing ? <CocktailEditor c={editing} bottles={cellar.data ?? []} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function CocktailEditor({ c, bottles, onClose }: { c: Cocktail; bottles: Bottle[]; onClose: () => void }) {
  const act = useAction();
  const [glass, setGlass] = useState(c.spec?.glass ?? "");
  const [garnish, setGarnish] = useState(c.spec?.garnish ?? "");
  const [method, setMethod] = useState(c.spec?.method ?? "");
  const [doses, setDoses] = useState(c.doses.map((d) => ({ ingredientId: d.ingredientId, quantity: String(d.quantity) })));
  const [busy, setBusy] = useState(false);
  const unitOf = (id: string) => bottles.find((b) => b.id === id)?.unit ?? "cl";
  const save = async () => {
    setBusy(true);
    const r = await act(() => api.put(`/api/bar/cocktails/${c.id}`, { glass: glass || null, garnish: garnish || null, method: method || null, doses: doses.filter((d) => d.ingredientId && num(d.quantity) > 0).map((d) => ({ ingredientId: d.ingredientId, quantity: num(d.quantity) })) }), { success: "Fiche enregistrée", invalidate: [["bar", "cocktails"]] });
    setBusy(false);
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} size="lg" title={`Fiche : ${c.name}`} footer={<Button size="lg" className="w-full" loading={busy} onClick={save} data-testid="cocktail-save">Enregistrer la fiche</Button>}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <Field label="Verre"><Input value={glass} onChange={(e) => setGlass(e.target.value)} maxLength={60} placeholder="Tumbler, coupe, verre à vin…" /></Field>
          <Field label="Garniture"><Input value={garnish} onChange={(e) => setGarnish(e.target.value)} maxLength={120} placeholder="Quartier d'ananas, feuille de menthe…" /></Field>
          <Field label="Préparation"><Textarea rows={4} value={method} onChange={(e) => setMethod(e.target.value)} maxLength={1000} placeholder="Au shaker avec glaçons, filtrer, compléter au soda…" /></Field>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-muted">Doses</p>
          {!bottles.length ? <p className="rounded-xl surface-2 p-3 text-sm text-muted">Ajoutez d&apos;abord vos bouteilles dans l&apos;onglet « Cave du bar ».</p> : null}
          {doses.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-20 shrink-0"><Input inputMode="decimal" value={d.quantity} onChange={(e) => setDoses(doses.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} aria-label="Dose" /></div>
              <span className="w-10 text-xs text-muted">{unitOf(d.ingredientId) === "pce" ? "pièce" : unitOf(d.ingredientId)}</span>
              <div className="min-w-0 flex-1"><Select value={d.ingredientId} onChange={(e) => setDoses(doses.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value } : x)))} aria-label="Boisson"><option value="">Choisir…</option>{bottles.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></div>
              <button type="button" onClick={() => setDoses(doses.filter((_, j) => j !== i))} className="touch flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-red-600 hover:bg-red-500/10" aria-label="Retirer la dose"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {bottles.length ? <Button variant="secondary" onClick={() => setDoses([...doses, { ingredientId: "", quantity: "4" }])} data-testid="dose-add"><Plus className="h-4 w-4" />Ajouter une dose</Button> : null}
          <div className="pt-2"><CocktailCard c={{ ...c, spec: { glass: glass || null, garnish: garnish || null, method: method || null }, doses: doses.filter((d) => d.ingredientId).map((d) => ({ ingredientId: d.ingredientId, name: bottles.find((b) => b.id === d.ingredientId)?.name ?? "", unit: unitOf(d.ingredientId), quantity: num(d.quantity) || 0, cost: 0 })) }} /></div>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Cave du bar
type BottleForm = { id?: string; name: string; barKind: BarKind; unit: "cl" | "pce"; bottleCl: string; minBottles: string; bottleCost: string };

export function Cellar({ manage }: { manage: boolean }) {
  const act = useAction();
  const q = useQuery({ queryKey: ["bar", "cellar"], queryFn: () => api.get<Bottle[]>("/api/bar/cellar") });
  const [form, setForm] = useState<BottleForm | null>(null);
  const [receive, setReceive] = useState<{ b: Bottle; bottles: string; cost: string } | null>(null);
  const [counting, setCounting] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<BarKind, Bottle[]>();
    for (const b of q.data ?? []) m.set(b.barKind, [...(m.get(b.barKind) ?? []), b]);
    return [...m.entries()];
  }, [q.data]);
  if (q.isLoading) return <Spinner />;
  const total = (q.data ?? []).reduce((a, b) => a + b.value, 0);
  const low = (q.data ?? []).filter((b) => b.low);
  const saveBottle = async () => {
    if (!form) return;
    setBusy(true);
    const body = { name: form.name, barKind: form.barKind, unit: form.unit, bottleMl: form.unit === "cl" ? Math.round(num(form.bottleCl) * 10) : null, minBottles: num(form.minBottles) || 0, ...(form.bottleCost ? { bottleCost: Math.round(num(form.bottleCost)) } : {}) };
    const r = await act(() => (form.id ? api.patch(`/api/bar/cellar/${form.id}`, body) : api.post("/api/bar/cellar", body)), { success: form.id ? "Boisson modifiée" : "Boisson ajoutée à la cave", invalidate: [["bar", "cellar"]] });
    setBusy(false);
    if (r) setForm(null);
  };
  const saveReceive = async () => {
    if (!receive) return;
    setBusy(true);
    const r = await act(() => api.post(`/api/bar/cellar/${receive.b.id}/receive`, { bottles: num(receive.bottles), bottleCost: receive.cost ? Math.round(num(receive.cost)) : null }), { success: "Réception enregistrée", invalidate: [["bar", "cellar"]] });
    setBusy(false);
    if (r) setReceive(null);
  };
  const saveCount = async () => {
    if (!counting) return;
    setBusy(true);
    const counts = Object.entries(counting).filter(([, v]) => v.trim() !== "").map(([id, v]) => ({ id, bottles: num(v) }));
    const r = await act(() => api.post<{ totalValue: number }>("/api/bar/cellar/inventory", { counts }), { invalidate: [["bar", "cellar"]] });
    setBusy(false);
    if (r) setCounting(null);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted">Valeur de la cave : <b className="text-[var(--text)]"><Money amount={total} /></b>{low.length ? <span className="ml-2 font-semibold text-corail-500">· {low.length} à commander</span> : null}</p>
        {manage ? <Button variant="secondary" onClick={() => setCounting(Object.fromEntries((q.data ?? []).map((b) => [b.id, ""])))} data-testid="cellar-count"><ClipboardList className="h-4 w-4" />Inventaire</Button> : null}
        {manage ? <Button onClick={() => setForm({ name: "", barKind: "spirit", unit: "cl", bottleCl: "70", minBottles: "1", bottleCost: "" })} data-testid="bottle-add"><Plus className="h-4 w-4" />Ajouter une boisson</Button> : null}
      </div>
      {!q.data?.length ? <p className="rounded-2xl surface-2 px-4 py-10 text-center text-sm text-muted">Votre cave est vide. Ajoutez vos bouteilles (rhum, vodka, vin, bière…) : le stock se suit en bouteilles et en cl, et baisse à chaque cocktail vendu.</p> : null}
      {groups.map(([kind, rows]) => (
        <Card key={kind} title={BAR_KIND_LABEL[kind]}>
          <div className="-mx-4 -my-2 divide-y divide-[var(--border)]">
            {rows.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5" data-testid="bottle-row">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{b.name} {b.unit === "cl" && b.bottleMl ? <span className="text-xs font-normal text-muted">{b.bottleMl / 10} cl</span> : null}</p>
                  <p className={`text-sm ${b.out ? "font-bold text-red-600" : b.low ? "font-bold text-corail-500" : "text-muted"}`}>{stockLabel(b)}{b.low ? ` · seuil ${stockLabel({ ...b, stockQty: b.stockMin })}` : ""}</p>
                </div>
                {counting ? (
                  <div className="flex items-center gap-1">
                    <div className="w-20"><Input inputMode="decimal" value={counting[b.id] ?? ""} onChange={(e) => setCounting({ ...counting, [b.id]: e.target.value })} placeholder={String(b.bottles)} aria-label={`Compté : ${b.name}`} /></div>
                    <span className="text-xs text-muted">{b.unit === "cl" ? "bout." : "pce"}</span>
                    {b.unit === "cl" ? ["¼", "½", "¾"].map((f, i) => <button key={f} type="button" onClick={() => setCounting({ ...counting, [b.id]: String(Math.floor(num(counting[b.id] || "0")) + (i + 1) / 4) })} className="touch h-9 w-9 rounded-lg surface-2 text-sm font-bold">{f}</button>) : null}
                  </div>
                ) : (
                  <>
                    <span className="text-sm tabular-nums text-muted"><Money amount={b.value} /></span>
                    {manage ? <Button variant="secondary" onClick={() => setReceive({ b, bottles: "6", cost: b.bottleCost ? String(b.bottleCost) : "" })} aria-label={`Réception : ${b.name}`}><PackagePlus className="h-4 w-4" /></Button> : null}
                    {manage ? <Button variant="ghost" onClick={() => setForm({ id: b.id, name: b.name, barKind: b.barKind, unit: b.unit === "pce" ? "pce" : "cl", bottleCl: b.bottleMl ? String(b.bottleMl / 10) : "70", minBottles: String(b.minBottles), bottleCost: b.bottleCost ? String(b.bottleCost) : "" })} aria-label={`Modifier : ${b.name}`}><Pencil className="h-4 w-4" /></Button> : null}
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}
      {counting ? (
        <div className="sticky bottom-3 flex gap-2 rounded-2xl glass p-3 shadow-lift">
          <p className="mr-auto self-center text-sm text-muted">Bouteilles pleines + l&apos;entamée (¼, ½, ¾). Laissez vide ce que vous n&apos;avez pas compté.</p>
          <Button variant="secondary" onClick={() => setCounting(null)}>Annuler</Button>
          <Button loading={busy} onClick={saveCount} data-testid="cellar-count-save">Valider l&apos;inventaire</Button>
        </div>
      ) : null}
      {form ? (
        <Modal open onClose={() => setForm(null)} size="sm" title={form.id ? "Modifier la boisson" : "Ajouter une boisson"} footer={<Button size="lg" className="w-full" loading={busy} disabled={!form.name.trim() || (form.unit === "cl" && !(num(form.bottleCl) >= 5))} onClick={saveBottle} data-testid="bottle-save">Enregistrer</Button>}>
          <div className="space-y-3">
            <Field label="Nom"><Input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} placeholder="Rhum blanc, vin rouge, bière…" data-testid="bottle-name" /></Field>
            <Field label="Famille"><Select value={form.barKind} onChange={(e) => setForm({ ...form, barKind: e.target.value as BarKind })}>{(Object.keys(BAR_KIND_LABEL) as BarKind[]).map((k) => <option key={k} value={k}>{BAR_KIND_LABEL[k]}</option>)}</Select></Field>
            <Field label="Se compte"><div className="flex gap-1.5">{(["cl", "pce"] as const).map((u) => <button key={u} type="button" onClick={() => setForm({ ...form, unit: u })} className={`touch h-11 flex-1 rounded-xl text-sm font-bold ${form.unit === u ? "bg-lagon-600 text-white" : "surface-2"}`}>{u === "cl" ? "Au cl (bouteille entamée)" : "À la pièce (canette, bouteille)"}</button>)}</div></Field>
            {form.unit === "cl" ? <Field label="Contenance d'une bouteille (cl)"><Input inputMode="decimal" value={form.bottleCl} onChange={(e) => setForm({ ...form, bottleCl: e.target.value })} /></Field> : null}
            <div className="grid grid-cols-2 gap-2">
              <Field label={form.unit === "cl" ? "Alerte sous (bouteilles)" : "Alerte sous (pièces)"}><Input inputMode="decimal" value={form.minBottles} onChange={(e) => setForm({ ...form, minBottles: e.target.value })} /></Field>
              <Field label={form.unit === "cl" ? "Prix d'achat d'une bouteille" : "Prix d'achat d'une pièce"}><Input inputMode="numeric" value={form.bottleCost} onChange={(e) => setForm({ ...form, bottleCost: e.target.value })} placeholder="F" /></Field>
            </div>
          </div>
        </Modal>
      ) : null}
      {receive ? (
        <Modal open onClose={() => setReceive(null)} size="sm" title={`Réception : ${receive.b.name}`} footer={<Button size="lg" className="w-full" loading={busy} disabled={!(num(receive.bottles) > 0)} onClick={saveReceive} data-testid="receive-save">Ajouter au stock</Button>}>
          <div className="grid grid-cols-2 gap-2">
            <Field label={receive.b.unit === "cl" ? "Bouteilles reçues" : "Pièces reçues"}><Input autoFocus inputMode="decimal" value={receive.bottles} onChange={(e) => setReceive({ ...receive, bottles: e.target.value })} /></Field>
            <Field label="Prix d'achat unitaire"><Input inputMode="numeric" value={receive.cost} onChange={(e) => setReceive({ ...receive, cost: e.target.value })} placeholder="F" /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ Rapport
export function BarReportView() {
  const { timezone } = useSession();
  const today = localDay(new Date(), timezone);
  const [range, setRange] = useState({ from: addDays(today, -6), to: today });
  const q = useQuery({ queryKey: ["bar", "report", range.from, range.to], queryFn: () => api.get<BarReport>(`/api/bar/report?from=${range.from}&to=${range.to}`) });
  const r = q.data;
  const kpi = (label: string, value: React.ReactNode, sub?: React.ReactNode, testId?: string) => (
    <div className="card p-4" data-testid={testId}><p className="text-xs font-semibold uppercase text-muted">{label}</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p>{sub ? <p className="text-xs text-muted">{sub}</p> : null}</div>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Du"><Input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="Au"><Input type="date" value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></Field>
        {[["7 jours", 6], ["30 jours", 29]].map(([l, d]) => <Button key={l} variant="secondary" onClick={() => setRange({ from: addDays(today, -(d as number)), to: today })}>{l}</Button>)}
      </div>
      {q.isLoading || !r ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {kpi("Boissons vendues", r.drinks.quantity, <Money amount={r.drinks.revenue} />, "kpi-drinks")}
            {kpi("Happy hour", r.happyHour.quantity, <>remise <Money amount={r.happyHour.discount} /></>)}
            {kpi("Offerts", r.offered.quantity, <Money amount={r.offered.value} />, "kpi-offered")}
            {kpi("Ardoises réglées", r.tabs.count, r.tabs.count ? <>panier moyen <Money amount={r.tabs.average} /></> : null)}
            {kpi("Casse et pertes", <Money amount={r.losses.value} />, `${r.losses.rows.length} enregistrement${r.losses.rows.length > 1 ? "s" : ""}`, "kpi-losses")}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Meilleures ventes du bar">
              {r.drinks.top.length ? <ol className="space-y-1.5">{r.drinks.top.map((t, i) => <li key={t.name} className="flex items-center gap-2 text-sm"><span className="w-5 text-right font-bold text-muted">{i + 1}</span><span className="min-w-0 flex-1 truncate">{t.name}</span><span className="font-bold tabular-nums">{t.quantity}</span><Money amount={t.revenue} className="w-24 text-right text-muted" /></li>)}</ol> : <p className="text-sm text-muted">Aucune boisson vendue sur la période.</p>}
            </Card>
            <Card title="Offerts">
              {r.offered.quantity ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><p className="mb-1 text-xs font-semibold uppercase text-muted">Par motif</p>{r.offered.byReason.map((g) => <p key={g.key} className="flex justify-between text-sm"><span className="truncate">{g.key} ({g.count})</span><Money amount={g.value} /></p>)}</div>
                  <div><p className="mb-1 text-xs font-semibold uppercase text-muted">Par personne</p>{r.offered.byPerson.map((g) => <p key={g.key} className="flex justify-between text-sm"><span className="truncate">{g.key} ({g.count})</span><Money amount={g.value} /></p>)}</div>
                </div>
              ) : <p className="text-sm text-muted">Rien n&apos;a été offert sur la période.</p>}
            </Card>
            <Card title="Casse et pertes">
              {r.losses.rows.length ? <ul className="space-y-1.5">{r.losses.rows.map((l, i) => <li key={i} className="flex items-baseline gap-2 text-sm"><span className="min-w-0 flex-1"><b>{l.name}</b> · {l.bottles !== null ? `${l.bottles} bout.` : `${l.quantity} ${l.unit}`} · {l.reason}<span className="block text-xs text-muted">{formatDateTime(l.at, timezone)}{l.by ? ` · ${l.by}` : ""}</span></span><Money amount={l.value} /></li>)}</ul> : <p className="text-sm text-muted">Aucune casse enregistrée.</p>}
            </Card>
            <Card title="À commander">
              {r.cellar.low.length ? <ul className="space-y-1.5">{r.cellar.low.map((b) => <li key={b.id} className="flex items-center gap-2 text-sm"><AlertTriangle className={`h-4 w-4 ${b.out ? "text-red-600" : "text-corail-500"}`} /><span className="min-w-0 flex-1 truncate">{b.name}</span><span className="text-muted">{stockLabel(b)}</span></li>)}</ul> : <p className="text-sm text-muted">Tout est au-dessus du seuil.</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
