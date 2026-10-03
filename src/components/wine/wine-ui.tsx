"use client";
/* eslint-disable @next/next/no-img-element -- photo d'étiquette envoyée par le restaurant */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ClipboardList, Download, GlassWater, MapPin, PackageMinus, PackagePlus, Pencil, Plus, Search, Tags, Trash2, Wine as WineIcon } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea, Toggle } from "@/components/ui/field";
import { Card, Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { PhotoField } from "@/components/photo-field";
import { addDays, formatDateTime, localDay } from "@/lib/dates";
import {
  BOTTLE_SIZES, DEFAULT_KEEP_DAYS, DEFAULT_SERVING_ML, DRINK_WINDOW_LABEL, WINE_COLORS, WINE_COLOR_DOT, WINE_COLOR_LABEL, WINE_COLOR_PLURAL, WINE_REMOVALS, WINE_SERVING_LABEL, clLabel,
  type WineColor, type WineRemoval, type WineServing,
} from "@/lib/wine";
import type { OpenBottle, Wine, WineDetail, WineList, WineReport, WineSettings } from "./types";

const num = (v: string) => Number(v.replace(",", ".").replace(/\s/g, ""));
const bottlesLabel = (b: number) => `${String(b).replace(".", ",")} bout.`;
const formatLabel = (f: { serving: WineServing; ml: number }) => (f.serving === "BOTTLE" ? (f.ml === 750 ? "Bouteille" : clLabel(f.ml)) : `${WINE_SERVING_LABEL[f.serving]} ${clLabel(f.ml)}`);
const INVALIDATE = [["wine"]];

export function ColorDot({ color, className = "" }: { color: WineColor; className?: string }) {
  return <span aria-hidden className={`inline-block h-3 w-3 shrink-0 rounded-full ring-2 ring-white/60 dark:ring-black/30 ${className}`} style={{ background: WINE_COLOR_DOT[color] }} />;
}

function useWines() {
  return useQuery({ queryKey: ["wine", "list"], queryFn: () => api.get<Wine[]>("/api/wine") });
}

// ------------------------------------------------------------------ Cave
export function WineCellar({ manage }: { manage: boolean }) {
  const act = useAction();
  const q = useWines();
  const [search, setSearch] = useState("");
  const [color, setColor] = useState<WineColor | "ALL">("ALL");
  const [location, setLocation] = useState("");
  const [byLocation, setByLocation] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [editing, setEditing] = useState<Wine | "new" | null>(null);
  const [counting, setCounting] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const wines = useMemo(() => q.data ?? [], [q.data]);
  const locations = useMemo(() => [...new Set(wines.map((w) => w.location).filter((l): l is string => !!l))].sort((a, b) => a.localeCompare(b, "fr")), [wines]);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return wines.filter((w) => (color === "ALL" || w.color === color) && (!location || w.location === location)
      && (!s || [w.label, w.appellation, w.region, w.country, w.grapes.join(" "), w.location].filter(Boolean).join(" ").toLowerCase().includes(s)));
  }, [wines, search, color, location]);
  const groups = useMemo(() => {
    if (byLocation) {
      const m = new Map<string, Wine[]>();
      for (const w of filtered) m.set(w.location ?? "", [...(m.get(w.location ?? "") ?? []), w]);
      return [...m.entries()].sort(([a], [b]) => (a ? (b ? a.localeCompare(b, "fr") : -1) : 1)).map(([k, rows]) => ({ key: k || "-", title: k || "Sans emplacement", rows }));
    }
    return WINE_COLORS.map((c) => ({ key: c, title: WINE_COLOR_PLURAL[c], rows: filtered.filter((w) => w.color === c) })).filter((g) => g.rows.length);
  }, [filtered, byLocation]);
  if (q.isLoading) return <Spinner />;
  const active = wines;
  const totals = { refs: active.length, bottles: Math.round(active.reduce((a, w) => a + w.bottles, 0) * 10) / 10, value: active.reduce((a, w) => a + w.value, 0), low: active.filter((w) => w.low && w.minBottles > 0).length, open: active.reduce((a, w) => a + w.open.length, 0) };
  const saveCount = async () => {
    if (!counting) return;
    setBusy(true);
    const counts = Object.entries(counting).filter(([, v]) => v.trim() !== "").map(([id, v]) => ({ id, bottles: num(v) }));
    const r = counts.length ? await act(() => api.post("/api/wine/inventory", { counts, location: location || null }), { success: "Inventaire enregistré", invalidate: INVALIDATE }) : null;
    setBusy(false);
    if (r || !counts.length) setCounting(null);
  };
  const kpi = (label: string, value: React.ReactNode, testId?: string) => <div className="card p-3" data-testid={testId}><p className="text-[11px] font-semibold uppercase text-muted">{label}</p><p className="mt-0.5 text-xl font-extrabold tabular-nums">{value}</p></div>;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {kpi("Références", totals.refs)}
        {kpi("Bouteilles", String(totals.bottles).replace(".", ","), "wine-kpi-bottles")}
        {kpi("Ouvertes", totals.open)}
        {manage ? kpi("Valeur", <Money amount={totals.value} />) : null}
        {kpi("À commander", <span className={totals.low ? "text-corail-500" : ""}>{totals.low}</span>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64 max-w-full"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Domaine, appellation, cépage…" className="pl-9" aria-label="Rechercher un vin" /></div>
        {locations.length ? <div className="w-48"><Select value={location} onChange={(e) => setLocation(e.target.value)} aria-label="Emplacement"><option value="">Tous les emplacements</option>{locations.map((l) => <option key={l} value={l}>{l}</option>)}</Select></div> : null}
        <Toggle checked={byLocation} onChange={setByLocation} label="Par emplacement" />
        <span className="ml-auto flex gap-2">
          {manage ? <Button variant="secondary" onClick={() => setCounting(Object.fromEntries(filtered.map((w) => [w.id, ""])))} data-testid="wine-count"><ClipboardList className="h-4 w-4" />Inventaire</Button> : null}
          {manage ? <Button onClick={() => setEditing("new")} data-testid="wine-add"><Plus className="h-4 w-4" />Nouveau vin</Button> : null}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Couleur">
        {(["ALL", ...WINE_COLORS.filter((c) => wines.some((w) => w.color === c))] as const).map((c) => (
          <button key={c} type="button" onClick={() => setColor(c)} aria-pressed={color === c} className={`touch flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${color === c ? "bg-rose-800 text-white" : "surface-2"}`}>
            {c !== "ALL" ? <ColorDot color={c} /> : null}{c === "ALL" ? "Tous" : WINE_COLOR_LABEL[c]}
          </button>
        ))}
      </div>
      {!wines.length ? <p className="rounded-2xl surface-2 px-4 py-10 text-center text-sm text-muted">{manage ? "Votre cave est vide. Ajoutez vos vins : fiche, emplacement, stock en bouteilles, puis leurs prix à la bouteille, au verre ou en carafe." : "La cave à vin n'a pas encore de vins."}</p> : null}
      {wines.length && !filtered.length ? <p className="py-6 text-center text-sm text-muted">Aucun vin ne correspond.</p> : null}
      {groups.map((g) => (
        <Card key={g.key} title={g.title}>
          <div className="-mx-4 -my-2 divide-y divide-[var(--border)]">
            {g.rows.map((w) => (
              <div key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5" data-testid="wine-row">
                <button type="button" onClick={() => setSheet(w.id)} className="touch flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Fiche : ${w.label}`}>
                  <ColorDot color={w.color} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{w.label}</span>
                    <span className="block truncate text-xs text-muted">{[...new Set([w.appellation, w.region, byLocation ? null : w.location].filter(Boolean))].join(" · ") || WINE_COLOR_LABEL[w.color]}</span>
                  </span>
                </button>
                {counting ? (
                  <div className="flex items-center gap-1">
                    <div className="w-20"><Input inputMode="numeric" value={counting[w.id] ?? ""} onChange={(e) => setCounting({ ...counting, [w.id]: e.target.value })} placeholder={String(Math.floor(w.bottles))} aria-label={`Compté : ${w.label}`} /></div>
                    <span className="text-xs text-muted">pleines</span>
                  </div>
                ) : (
                  <>
                    <span className="flex flex-wrap items-center gap-1">
                      {w.drinkWindow === "LATE" ? <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">À boire</span> : null}
                      {w.open.some((b) => b.overdue) ? <span className="rounded-md bg-red-500/12 px-1.5 py-0.5 text-[11px] font-bold text-red-600">Ouverte à écouler</span> : null}
                      {!w.formats.some((f) => f.isActive) && manage ? <span className="rounded-md surface-2 px-1.5 py-0.5 text-[11px] font-bold text-muted">Pas en vente</span> : null}
                    </span>
                    <span className={`w-28 text-right text-sm font-bold tabular-nums ${w.out ? "text-red-600" : w.low && w.minBottles > 0 ? "text-corail-500" : ""}`} data-testid="wine-stock">
                      {bottlesLabel(w.bottles)}{w.open.length ? <span className="block text-[11px] font-semibold text-muted">+ {w.open.length} ouverte{w.open.length > 1 ? "s" : ""}</span> : null}
                    </span>
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      ))}
      {counting ? (
        <div className="sticky bottom-3 flex flex-wrap gap-2 rounded-2xl glass p-3 shadow-lift">
          <p className="mr-auto self-center text-sm text-muted">Comptez les bouteilles pleines{location ? ` de « ${location} »` : ""} ; les bouteilles ouvertes gardent leur niveau. Laissez vide ce que vous n&apos;avez pas compté.</p>
          <Button variant="secondary" onClick={() => setCounting(null)}>Annuler</Button>
          <Button loading={busy} onClick={saveCount} data-testid="wine-count-save">Valider l&apos;inventaire</Button>
        </div>
      ) : null}
      {sheet ? <WineSheet id={sheet} manage={manage} onClose={() => setSheet(null)} onEdit={(w) => { setSheet(null); setEditing(w); }} /> : null}
      {editing ? <WineEditor wine={editing === "new" ? null : editing} locations={locations} onClose={() => setEditing(null)} onSaved={(w) => { setEditing(null); setSheet(w.id); }} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ Fiche
export function WineSheet({ id, manage, onClose, onEdit }: { id: string; manage: boolean; onClose: () => void; onEdit?: (w: Wine) => void }) {
  const { timezone } = useSession();
  const act = useAction();
  const q = useQuery({ queryKey: ["wine", "detail", id], queryFn: () => api.get<WineDetail>(`/api/wine/${id}`) });
  const [modal, setModal] = useState<"formats" | "receive" | "remove" | null>(null);
  const w = q.data;
  const year = new Date().getFullYear();
  return (
    <Modal open onClose={onClose} size="lg" title={w ? w.label : "Fiche du vin"}>
      {!w ? <Spinner /> : (
        <div className="space-y-4" data-testid="wine-sheet">
          <div className="flex flex-col gap-4 sm:flex-row">
            {w.imageUrl ? <img src={w.imageUrl} alt={`Étiquette : ${w.label}`} className="h-44 w-32 shrink-0 self-center rounded-2xl object-cover shadow-soft sm:self-start" /> : null}
            <div className="min-w-0 flex-1 space-y-2">
              <p className="flex flex-wrap items-center gap-2 text-sm"><ColorDot color={w.color} /><b>{WINE_COLOR_LABEL[w.color]}</b>{w.isOrganic ? <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Bio</span> : null}{w.drinkWindow ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${w.drinkWindow === "LATE" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : w.drinkWindow === "KEEP" ? "bg-sky-500/12 text-sky-700 dark:text-sky-300" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"}`}>{DRINK_WINDOW_LABEL[w.drinkWindow]}</span> : null}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                {w.appellation ? <><dt className="text-muted">Appellation</dt><dd>{w.appellation}</dd></> : null}
                {w.region || w.country ? <><dt className="text-muted">Région</dt><dd>{[w.region, w.country].filter(Boolean).join(", ")}</dd></> : null}
                {w.grapes.length ? <><dt className="text-muted">Cépages</dt><dd>{w.grapes.join(", ")}</dd></> : null}
                {w.abv ? <><dt className="text-muted">Degré</dt><dd>{String(w.abv).replace(".", ",")} %</dd></> : null}
                {w.servingTemp ? <><dt className="text-muted">Service</dt><dd>{w.servingTemp}</dd></> : null}
                {w.drinkFrom || w.drinkUntil ? <><dt className="text-muted">Apogée</dt><dd>{w.drinkFrom ?? "…"} – {w.drinkUntil ?? "…"}{w.vintage ? <span className="text-muted"> · vin de {year - w.vintage} an{year - w.vintage > 1 ? "s" : ""}</span> : null}</dd></> : null}
                <dt className="text-muted">Bouteille</dt><dd>{clLabel(w.bottleMl)}</dd>
              </dl>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl surface-2 p-3"><p className="text-[11px] font-semibold uppercase text-muted">En cave</p><p className={`text-xl font-extrabold ${w.out ? "text-red-600" : w.low && w.minBottles > 0 ? "text-corail-500" : ""}`} data-testid="sheet-bottles">{bottlesLabel(w.bottles)}</p>{w.minBottles > 0 ? <p className="text-xs text-muted">alerte sous {bottlesLabel(w.minBottles)}</p> : null}</div>
            <div className="rounded-2xl surface-2 p-3"><p className="text-[11px] font-semibold uppercase text-muted">Ouvertes</p><p className="text-xl font-extrabold">{w.open.length}</p><p className="text-xs text-muted">{w.open.length ? w.open.map((b) => clLabel(b.remainingMl)).join(" · ") : `se garde ${w.keepDays} j ouverte`}</p></div>
            <div className="rounded-2xl surface-2 p-3"><p className="flex items-center gap-1 text-[11px] font-semibold uppercase text-muted"><MapPin className="h-3 w-3" />Emplacement</p><p className="truncate text-base font-bold">{w.location ?? "—"}</p>{manage ? <p className="text-xs text-muted">valeur <Money amount={w.value} /> · <Money amount={w.bottleCost} />/btl</p> : null}</div>
          </div>
          {w.tastingNotes ? <section><h3 className="mb-1 text-xs font-bold uppercase text-muted">Dégustation</h3><p className="whitespace-pre-line text-sm leading-relaxed">{w.tastingNotes}</p></section> : null}
          {w.pairingNotes || w.dishes.length ? (
            <section data-testid="sheet-pairings"><h3 className="mb-1 text-xs font-bold uppercase text-muted">Accords</h3>
              {w.pairingNotes ? <p className="text-sm">{w.pairingNotes}</p> : null}
              {w.dishes.length ? <div className="mt-1.5 flex flex-wrap gap-1.5">{w.dishes.map((d) => <span key={d.id} className="rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-800 dark:text-rose-200">{d.name}</span>)}</div> : null}
            </section>
          ) : null}
          <section><h3 className="mb-1 text-xs font-bold uppercase text-muted">En vente</h3>
            {w.formats.some((f) => f.isActive) ? <div className="flex flex-wrap gap-2">{w.formats.filter((f) => f.isActive).map((f) => <span key={f.productId} className={`rounded-xl px-3 py-1.5 text-sm ${f.available ? "surface-2" : "surface-2 opacity-50 line-through"}`}>{formatLabel(f)} <b><Money amount={f.priceTtc} /></b></span>)}</div> : <p className="text-sm text-muted">Ce vin n&apos;est pas encore à la carte.{manage ? " Fixez ses prix avec « Formats et prix »." : ""}</p>}
          </section>
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            {manage && onEdit ? <Button variant="secondary" onClick={() => onEdit(w)} data-testid="wine-edit"><Pencil className="h-4 w-4" />Modifier la fiche</Button> : null}
            {manage ? <Button variant="secondary" onClick={() => setModal("formats")} data-testid="wine-formats"><Tags className="h-4 w-4" />Formats et prix</Button> : null}
            {manage ? <Button variant="secondary" onClick={() => setModal("receive")} data-testid="wine-receive"><PackagePlus className="h-4 w-4" />Réception</Button> : null}
            <Button variant="secondary" onClick={() => setModal("remove")} data-testid="wine-remove"><PackageMinus className="h-4 w-4" />Casse ou sortie</Button>
            {w.bottles >= 1 ? <Button variant="ghost" onClick={() => act(() => api.post(`/api/wine/${w.id}/open`), { success: "Bouteille ouverte : suivie dans « Vin au verre »", invalidate: INVALIDATE })} data-testid="wine-open"><GlassWater className="h-4 w-4" />Ouvrir une bouteille</Button> : null}
          </div>
          {manage && w.movements.length ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-muted">Derniers mouvements</summary>
              <ul className="mt-2 space-y-1">{w.movements.map((m) => <li key={m.id} className="flex gap-2"><span className={`w-20 shrink-0 text-right font-bold tabular-nums ${m.cl < 0 ? "text-corail-500" : "text-emerald-600"}`}>{m.cl > 0 ? "+" : ""}{String(m.bottles).replace(".", ",")} btl</span><span className="min-w-0 flex-1 truncate">{m.reason ?? (m.kind === "SALE" ? "Vente" : m.kind)}</span><span className="shrink-0 text-xs text-muted">{formatDateTime(m.at, timezone)}{m.by ? ` · ${m.by}` : ""}</span></li>)}</ul>
            </details>
          ) : null}
        </div>
      )}
      {w && modal === "formats" ? <FormatsEditor wine={w} onClose={() => setModal(null)} /> : null}
      {w && modal === "receive" ? <ReceiveModal wine={w} onClose={() => setModal(null)} /> : null}
      {w && modal === "remove" ? <RemoveModal wine={w} onClose={() => setModal(null)} /> : null}
    </Modal>
  );
}

function ReceiveModal({ wine, onClose }: { wine: Wine; onClose: () => void }) {
  const act = useAction();
  const [bottles, setBottles] = useState("6");
  const [cost, setCost] = useState(wine.lastBottleCost ? String(wine.lastBottleCost) : "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await act(() => api.post(`/api/wine/${wine.id}/receive`, { bottles: Math.round(num(bottles)), bottleCost: cost ? Math.round(num(cost)) : null, note: note || null }), { success: "Réception enregistrée", invalidate: INVALIDATE });
    setBusy(false);
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Réception : ${wine.label}`} footer={<Button size="lg" className="w-full" loading={busy} disabled={!(Math.round(num(bottles)) > 0)} onClick={save} data-testid="receive-save">Ajouter à la cave</Button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Bouteilles reçues"><Input autoFocus inputMode="numeric" value={bottles} onChange={(e) => setBottles(e.target.value)} data-testid="receive-bottles" /></Field>
          <Field label="Prix d'achat (bouteille)"><Input inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="F" /></Field>
        </div>
        <Field label="Fournisseur, n° de facture (facultatif)"><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} /></Field>
      </div>
    </Modal>
  );
}

function RemoveModal({ wine, onClose }: { wine: Wine; onClose: () => void }) {
  const act = useAction();
  const [bottles, setBottles] = useState("1");
  const [kind, setKind] = useState<WineRemoval>("BREAKAGE");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const r = await act(() => api.post(`/api/wine/${wine.id}/remove`, { bottles: num(bottles), kind, reason }), { success: "Sortie enregistrée", invalidate: INVALIDATE });
    setBusy(false);
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Sortie : ${wine.label}`} footer={<Button size="lg" className="w-full" loading={busy} disabled={!(num(bottles) > 0) || reason.trim().length < 2} onClick={save} data-testid="remove-save">Enregistrer la sortie</Button>}>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">{(Object.keys(WINE_REMOVALS) as WineRemoval[]).map((k) => <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k} className={`touch h-10 rounded-xl px-3 text-sm font-semibold ${kind === k ? "bg-rose-800 text-white" : "surface-2"}`}>{WINE_REMOVALS[k]}</button>)}</div>
        <Field label="Bouteilles"><Input inputMode="decimal" value={bottles} onChange={(e) => setBottles(e.target.value)} /></Field>
        <Field label="Motif"><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} placeholder="Bouteille tombée, bouchonnée, dégustation équipe…" data-testid="remove-reason" /></Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Formats et prix
function FormatsEditor({ wine, onClose }: { wine: Wine; onClose: () => void }) {
  const act = useAction();
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api.get<{ id: string; name: string }[]>("/api/categories") });
  const taxes = useQuery({ queryKey: ["tax-rates"], queryFn: () => api.get<{ id: string; name: string; rateBps: number; isDefault: boolean }[]>("/api/tax-rates") });
  const stations = useQuery({ queryKey: ["kitchen-stations"], queryFn: () => api.get<{ id: string; name: string }[]>("/api/kitchen-stations") });
  const f = (s: WineServing) => wine.formats.find((x) => x.serving === s && x.isActive);
  const any = wine.formats[0];
  const [categoryId, setCategoryId] = useState(any?.categoryId ?? "");
  const [taxRateId, setTaxRateId] = useState(any?.taxRateId ?? "");
  const [stationId, setStationId] = useState(any?.kitchenStationId ?? "");
  const init = (s: WineServing) => ({ on: !!f(s), price: f(s) ? String(f(s)!.priceTtc) : "", cl: String((f(s)?.ml ?? (s === "BOTTLE" ? wine.bottleMl : DEFAULT_SERVING_ML[s])) / 10).replace(".", ",") });
  const [rows, setRows] = useState<Record<WineServing, { on: boolean; price: string; cl: string }>>({ BOTTLE: init("BOTTLE"), GLASS: init("GLASS"), CARAFE: init("CARAFE") });
  const [busy, setBusy] = useState(false);
  const costOf = (ml: number) => Math.round((wine.bottleCost * ml) / wine.bottleMl);
  const mlOf = (s: WineServing) => (s === "BOTTLE" ? wine.bottleMl : Math.round(num(rows[s].cl) * 10));
  const valid = (["BOTTLE", "GLASS", "CARAFE"] as const).every((s) => !rows[s].on || (num(rows[s].price) >= 0 && rows[s].price.trim() !== "" && mlOf(s) >= 50 && mlOf(s) <= wine.bottleMl)) && (!!categoryId || !(["BOTTLE", "GLASS", "CARAFE"] as const).some((s) => rows[s].on && !f(s)));
  const save = async () => {
    setBusy(true);
    const pick = (s: "GLASS" | "CARAFE") => (rows[s].on ? { priceTtc: Math.round(num(rows[s].price)), ml: mlOf(s) } : null);
    const body = { categoryId: categoryId || null, taxRateId: taxRateId || null, kitchenStationId: stationId || null, bottle: rows.BOTTLE.on ? { priceTtc: Math.round(num(rows.BOTTLE.price)) } : null, glass: pick("GLASS"), carafe: pick("CARAFE") };
    const r = await act(() => api.put(`/api/wine/${wine.id}/formats`, body), { success: "Prix enregistrés : le vin est à la carte", invalidate: [...INVALIDATE, ["pos-catalog"], ["products"]] });
    setBusy(false);
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} size="md" title={`Formats et prix : ${wine.label}`} footer={<Button size="lg" className="w-full" loading={busy} disabled={!valid} onClick={save} data-testid="formats-save">Enregistrer</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Chaque format devient un produit de la caisse. Le stock baisse à chaque vente : une bouteille entière, ou la dose du verre et de la carafe, versée d&apos;une bouteille ouverte.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Catégorie de la carte"><Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} data-testid="formats-category"><option value="">—</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="TVA"><Select value={taxRateId} onChange={(e) => setTaxRateId(e.target.value)}><option value="">Taux par défaut</option>{(taxes.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Envoyé au poste"><Select value={stationId} onChange={(e) => setStationId(e.target.value)}><option value="">—</option>{(stations.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        </div>
        {(["BOTTLE", "GLASS", "CARAFE"] as const).map((s) => {
          const r = rows[s];
          const ml = mlOf(s);
          const cost = ml > 0 ? costOf(ml) : 0;
          const price = num(r.price) || 0;
          return (
            <div key={s} className={`rounded-2xl p-3 ${r.on ? "surface-2" : "border border-dashed border-line"}`} data-testid={`format-${s.toLowerCase()}`}>
              <div className="flex flex-wrap items-center gap-3">
                <Toggle checked={r.on} onChange={(v) => setRows({ ...rows, [s]: { ...r, on: v } })} label={WINE_SERVING_LABEL[s]} />
                {r.on ? (
                  <>
                    {s !== "BOTTLE" ? <div className="w-24"><Input inputMode="decimal" value={r.cl} onChange={(e) => setRows({ ...rows, [s]: { ...r, cl: e.target.value } })} aria-label={`Contenance ${WINE_SERVING_LABEL[s]} (cl)`} /></div> : <span className="text-sm text-muted">{clLabel(wine.bottleMl)}</span>}
                    {s !== "BOTTLE" ? <span className="text-xs text-muted">cl</span> : null}
                    <div className="w-32"><Input inputMode="numeric" value={r.price} onChange={(e) => setRows({ ...rows, [s]: { ...r, price: e.target.value } })} placeholder="Prix TTC" aria-label={`Prix ${WINE_SERVING_LABEL[s]}`} /></div>
                    {wine.bottleCost > 0 && price > 0 ? <span className="text-xs text-muted">coût <Money amount={cost} /> · coef. ×{(price / Math.max(1, cost)).toFixed(1).replace(".", ",")}</span> : null}
                  </>
                ) : null}
              </div>
              {r.on && s !== "BOTTLE" && ml > 0 ? <p className="mt-1 text-xs text-muted">{Math.floor(wine.bottleMl / ml)} {s === "GLASS" ? "verres" : "carafe(s)"} par bouteille</p> : null}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Édition de la fiche
type FormState = {
  color: WineColor; producer: string; name: string; vintage: string; appellation: string; region: string; country: string; grapes: string; abv: string; isOrganic: boolean;
  bottleMl: number; location: string; minBottles: string; bottleCost: string; drinkFrom: string; drinkUntil: string; servingTemp: string; keepDays: string;
  tastingNotes: string; pairingNotes: string; pairedProductIds: string[]; imageUrl: string; showOnList: boolean;
};

function WineEditor({ wine, locations, onClose, onSaved }: { wine: Wine | null; locations: string[]; onClose: () => void; onSaved: (w: Wine) => void }) {
  const act = useAction();
  const products = useQuery({ queryKey: ["products", "dishes"], queryFn: () => api.get<{ id: string; name: string; wineId: string | null; isActive: boolean; category: { name: string } | null }[]>("/api/products") });
  const s = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));
  const [f, setF] = useState<FormState>(wine ? {
    color: wine.color, producer: s(wine.producer), name: wine.name, vintage: s(wine.vintage), appellation: s(wine.appellation), region: s(wine.region), country: s(wine.country), grapes: wine.grapes.join(", "),
    abv: s(wine.abv).replace(".", ","), isOrganic: wine.isOrganic, bottleMl: wine.bottleMl, location: s(wine.location), minBottles: s(wine.minBottles), bottleCost: wine.bottleCost ? String(wine.bottleCost) : "",
    drinkFrom: s(wine.drinkFrom), drinkUntil: s(wine.drinkUntil), servingTemp: s(wine.servingTemp), keepDays: s(wine.customKeepDays), tastingNotes: s(wine.tastingNotes), pairingNotes: s(wine.pairingNotes),
    pairedProductIds: wine.pairedProductIds, imageUrl: s(wine.imageUrl), showOnList: wine.showOnList,
  } : { color: "RED", producer: "", name: "", vintage: "", appellation: "", region: "", country: "France", grapes: "", abv: "", isOrganic: false, bottleMl: 750, location: "", minBottles: "2", bottleCost: "", drinkFrom: "", drinkUntil: "", servingTemp: "", keepDays: "", tastingNotes: "", pairingNotes: "", pairedProductIds: [], imageUrl: "", showOnList: true });
  const [dishSearch, setDishSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<FormState>) => setF({ ...f, ...p });
  const intOrNull = (v: string) => (v.trim() ? Math.round(num(v)) : null);
  const dishes = (products.data ?? []).filter((p) => !p.wineId && p.isActive);
  const shownDishes = dishes.filter((d) => f.pairedProductIds.includes(d.id) || (dishSearch.trim() && d.name.toLowerCase().includes(dishSearch.trim().toLowerCase()))).slice(0, 30);
  const save = async () => {
    setBusy(true);
    const body = {
      color: f.color, producer: f.producer || null, name: f.name, vintage: intOrNull(f.vintage), appellation: f.appellation || null, region: f.region || null, country: f.country || null,
      grapes: f.grapes.split(",").map((g) => g.trim()).filter(Boolean), abv: f.abv.trim() ? num(f.abv) : null, isOrganic: f.isOrganic, bottleMl: f.bottleMl, location: f.location || null,
      minBottles: num(f.minBottles) || 0, ...(f.bottleCost.trim() ? { bottleCost: Math.round(num(f.bottleCost)) } : {}), drinkFrom: intOrNull(f.drinkFrom), drinkUntil: intOrNull(f.drinkUntil),
      servingTemp: f.servingTemp || null, keepDays: intOrNull(f.keepDays), tastingNotes: f.tastingNotes || null, pairingNotes: f.pairingNotes || null, pairedProductIds: f.pairedProductIds,
      imageUrl: f.imageUrl || null, showOnList: f.showOnList,
    };
    const r = await act(() => (wine ? api.patch<Wine>(`/api/wine/${wine.id}`, body) : api.post<Wine>("/api/wine", body)), { success: wine ? "Fiche enregistrée" : "Vin ajouté à la cave", invalidate: INVALIDATE });
    setBusy(false);
    if (r) onSaved(r);
  };
  const archive = async () => {
    if (!wine || !window.confirm(`Retirer « ${wine.label} » de la cave ? Ses formats quittent la carte (l'historique des ventes est conservé).`)) return;
    const r = await act(() => api.delete(`/api/wine/${wine.id}`), { success: "Vin retiré de la cave", invalidate: INVALIDATE });
    if (r !== null) onClose();
  };
  return (
    <Modal open onClose={onClose} size="lg" title={wine ? "Modifier la fiche" : "Nouveau vin"} footer={
      <div className="flex w-full gap-2">
        {wine ? <Button variant="ghost" className="text-red-600" onClick={archive} aria-label="Retirer de la cave"><Trash2 className="h-4 w-4" /></Button> : null}
        <Button size="lg" className="flex-1" loading={busy} disabled={!f.name.trim()} onClick={save} data-testid="wine-save">Enregistrer</Button>
      </div>
    }>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Couleur">{WINE_COLORS.map((c) => <button key={c} type="button" onClick={() => set({ color: c })} aria-pressed={f.color === c} className={`touch flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ${f.color === c ? "bg-rose-800 text-white" : "surface-2"}`}><ColorDot color={c} />{WINE_COLOR_LABEL[c]}</button>)}</div>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_8rem]">
          <Field label="Domaine, château"><Input value={f.producer} onChange={(e) => set({ producer: e.target.value })} maxLength={80} data-testid="wine-producer" /></Field>
          <Field label="Cuvée"><Input autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} data-testid="wine-name" /></Field>
          <Field label="Millésime"><Input inputMode="numeric" value={f.vintage} onChange={(e) => set({ vintage: e.target.value })} placeholder="2020" data-testid="wine-vintage" /></Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Appellation"><Input value={f.appellation} onChange={(e) => set({ appellation: e.target.value })} maxLength={80} /></Field>
          <Field label="Région"><Input value={f.region} onChange={(e) => set({ region: e.target.value })} maxLength={60} data-testid="wine-region" /></Field>
          <Field label="Pays"><Input value={f.country} onChange={(e) => set({ country: e.target.value })} maxLength={40} /></Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-[1fr_7rem_auto]">
          <Field label="Cépages" hint="Séparés par des virgules"><Input value={f.grapes} onChange={(e) => set({ grapes: e.target.value })} /></Field>
          <Field label="Degré (%)"><Input inputMode="decimal" value={f.abv} onChange={(e) => set({ abv: e.target.value })} /></Field>
          <div className="self-end pb-2"><Toggle checked={f.isOrganic} onChange={(v) => set({ isOrganic: v })} label="Bio" /></div>
        </div>
        <fieldset className="grid gap-2 rounded-2xl surface-2 p-3 sm:grid-cols-4">
          <legend className="px-1 text-xs font-bold uppercase text-muted">Cave</legend>
          <Field label="Contenance"><Select value={String(f.bottleMl)} onChange={(e) => set({ bottleMl: Number(e.target.value) })}>{BOTTLE_SIZES.map((b) => <option key={b.ml} value={b.ml}>{b.label}</option>)}{!BOTTLE_SIZES.some((b) => b.ml === f.bottleMl) ? <option value={f.bottleMl}>{clLabel(f.bottleMl)}</option> : null}</Select></Field>
          <Field label="Emplacement"><Input value={f.location} onChange={(e) => set({ location: e.target.value })} list="wine-locations" maxLength={60} placeholder="Casier A, rangée 2" data-testid="wine-location" /><datalist id="wine-locations">{locations.map((l) => <option key={l} value={l} />)}</datalist></Field>
          <Field label="Alerte sous (btl)"><Input inputMode="decimal" value={f.minBottles} onChange={(e) => set({ minBottles: e.target.value })} /></Field>
          <Field label="Prix d'achat (btl)"><Input inputMode="numeric" value={f.bottleCost} onChange={(e) => set({ bottleCost: e.target.value })} placeholder="F" /></Field>
        </fieldset>
        <div className="grid gap-2 sm:grid-cols-4">
          <Field label="Apogée : de"><Input inputMode="numeric" value={f.drinkFrom} onChange={(e) => set({ drinkFrom: e.target.value })} placeholder="2024" /></Field>
          <Field label="à"><Input inputMode="numeric" value={f.drinkUntil} onChange={(e) => set({ drinkUntil: e.target.value })} placeholder="2030" /></Field>
          <Field label="Service"><Input value={f.servingTemp} onChange={(e) => set({ servingTemp: e.target.value })} maxLength={20} placeholder="16-18 °C" /></Field>
          <Field label="Garde ouverte (j)"><Input inputMode="numeric" value={f.keepDays} onChange={(e) => set({ keepDays: e.target.value })} placeholder={String(DEFAULT_KEEP_DAYS[f.color])} /></Field>
        </div>
        <Field label="Notes de dégustation"><Textarea rows={3} value={f.tastingNotes} onChange={(e) => set({ tastingNotes: e.target.value })} maxLength={1000} placeholder="Robe, nez, bouche : les mots que l'équipe peut dire au client" /></Field>
        <Field label="Accords mets-vins"><Input value={f.pairingNotes} onChange={(e) => set({ pairingNotes: e.target.value })} maxLength={400} placeholder="Poisson cru, viandes grillées, fromages…" /></Field>
        <Field label="Plats de la carte conseillés avec ce vin" hint="Proposé à la caisse quand ces plats sont commandés.">
          <div className="space-y-2">
            <div className="w-64 max-w-full"><Input value={dishSearch} onChange={(e) => setDishSearch(e.target.value)} placeholder="Chercher un plat…" aria-label="Chercher un plat" data-testid="dish-search" /></div>
            <div className="flex flex-wrap gap-1.5">{shownDishes.map((d) => <button key={d.id} type="button" onClick={() => set({ pairedProductIds: f.pairedProductIds.includes(d.id) ? f.pairedProductIds.filter((x) => x !== d.id) : [...f.pairedProductIds, d.id] })} aria-pressed={f.pairedProductIds.includes(d.id)} className={`touch h-9 rounded-full px-3 text-xs font-semibold ${f.pairedProductIds.includes(d.id) ? "bg-rose-800 text-white" : "surface-2"}`}>{d.name}</button>)}</div>
            {!shownDishes.length ? <p className="text-xs text-muted">Tapez le nom d&apos;un plat pour l&apos;ajouter.</p> : null}
          </div>
        </Field>
        <PhotoField value={f.imageUrl} onChange={(url) => set({ imageUrl: url })} label="Photo de l'étiquette" />
        <Toggle checked={f.showOnList} onChange={(v) => set({ showOnList: v })} label="Sur la carte des vins" />
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Vin au verre
export function OpenBottles() {
  const { timezone } = useSession();
  const act = useAction();
  const q = useQuery({ queryKey: ["wine", "open"], queryFn: () => api.get<OpenBottle[]>("/api/wine/open-bottles"), refetchInterval: 60_000 });
  const wines = useWines();
  const [opening, setOpening] = useState("");
  const [discard, setDiscard] = useState<OpenBottle | null>(null);
  const [level, setLevel] = useState<{ b: OpenBottle; cl: string } | null>(null);
  const [reason, setReason] = useState("");
  if (q.isLoading) return <Spinner />;
  const rows = q.data ?? [];
  const canOpen = (wines.data ?? []).filter((w) => w.bottles >= 1);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Chaque verre ou carafe vendu est versé de la plus ancienne bouteille ouverte ; la suivante s&apos;ouvre toute seule. Une bouteille ouverte depuis trop longtemps passe en rouge : à écouler, ou à jeter.</p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Ouvrir une bouteille" className="w-72 max-w-full"><Select value={opening} onChange={(e) => setOpening(e.target.value)} data-testid="open-pick"><option value="">Choisir un vin…</option>{canOpen.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</Select></Field>
        <Button variant="secondary" disabled={!opening} onClick={async () => { const r = await act(() => api.post(`/api/wine/${opening}/open`), { success: "Bouteille ouverte", invalidate: INVALIDATE }); if (r) setOpening(""); }} data-testid="open-save"><GlassWater className="h-4 w-4" />Ouvrir</Button>
      </div>
      {!rows.length ? <p className="rounded-2xl surface-2 px-4 py-10 text-center text-sm text-muted">Aucune bouteille ouverte pour le moment.</p> : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map((b) => {
          const pct = Math.round((b.remainingMl / b.bottleMl) * 100);
          return (
            <div key={b.id} className={`card min-w-0 p-3 ${b.overdue ? "ring-2 ring-red-500/60" : ""}`} data-testid="open-bottle">
              <div className="flex items-start gap-2">
                <ColorDot color={b.color} className="mt-1.5" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{b.label}</p>
                  <p className="text-xs text-muted">ouverte {b.ageDays === 0 ? "aujourd'hui" : b.ageDays === 1 ? "hier" : `il y a ${b.ageDays} jours`} · {formatDateTime(b.openedAt, timezone)} · se garde {b.keepDays} j</p>
                </div>
                {b.overdue ? <span className="flex shrink-0 items-center gap-1 rounded-md bg-red-500/12 px-1.5 py-0.5 text-[11px] font-bold text-red-600"><AlertTriangle className="h-3 w-3" />À écouler</span> : null}
              </div>
              <div className="mt-2 flex items-center gap-3">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Niveau de la bouteille"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: WINE_COLOR_DOT[b.color] }} /></div>
                <span className="w-28 text-right text-sm font-bold tabular-nums">{clLabel(b.remainingMl)}{b.glassesLeft !== null ? <span className="block text-[11px] font-semibold text-muted">{b.glassesLeft} verre{b.glassesLeft > 1 ? "s" : ""}</span> : null}</span>
              </div>
              <div className="mt-2 flex justify-end gap-1.5">
                <Button variant="ghost" onClick={() => setLevel({ b, cl: String(b.remainingMl / 10).replace(".", ",") })}>Niveau</Button>
                <Button variant="ghost" className="text-red-600" onClick={() => { setReason(b.overdue ? "Ouverte depuis trop longtemps" : ""); setDiscard(b); }} data-testid="open-discard">Jeter la fin</Button>
              </div>
            </div>
          );
        })}
      </div>
      {discard ? (
        <Modal open onClose={() => setDiscard(null)} size="sm" title="Jeter la fin de la bouteille" footer={<Button size="lg" variant="danger" className="w-full" onClick={async () => { const r = await act(() => api.post(`/api/wine/open-bottles/${discard.id}/discard`, { reason: reason || null }), { success: "Fin de bouteille jetée (perte enregistrée)", invalidate: INVALIDATE }); if (r) setDiscard(null); }} data-testid="discard-save">Jeter {clLabel(discard.remainingMl)}</Button>}>
          <div className="space-y-3"><p className="text-sm">{discard.label}</p><Field label="Motif"><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} placeholder="Oxydé, ouverte depuis trop longtemps…" /></Field></div>
        </Modal>
      ) : null}
      {level ? (
        <Modal open onClose={() => setLevel(null)} size="sm" title="Niveau de la bouteille" footer={<Button size="lg" className="w-full" onClick={async () => { const r = await act(() => api.patch(`/api/wine/open-bottles/${level.b.id}`, { remainingMl: Math.round(num(level.cl) * 10) }), { success: "Niveau corrigé", invalidate: INVALIDATE }); if (r) setLevel(null); }}>Enregistrer</Button>}>
          <div className="space-y-3">
            <p className="text-sm">{level.b.label}</p>
            <div className="flex gap-1.5">{[0.25, 0.5, 0.75].map((k) => <button key={k} type="button" onClick={() => setLevel({ ...level, cl: String(Math.round((level.b.bottleMl * k) / 10)).replace(".", ",") })} className="touch h-10 flex-1 rounded-xl surface-2 text-sm font-bold">{k === 0.25 ? "¼" : k === 0.5 ? "½" : "¾"}</button>)}</div>
            <Field label="Il reste (cl)"><Input inputMode="decimal" value={level.cl} onChange={(e) => setLevel({ ...level, cl: e.target.value })} /></Field>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ Carte des vins
export function WineListView({ manage }: { manage: boolean }) {
  const { currency } = useSession();
  const q = useQuery({ queryKey: ["wine", "carte"], queryFn: () => api.get<WineList>("/api/wine/list") });
  if (q.isLoading || !q.data) return <Spinner />;
  const l = q.data;
  return (
    <div className="space-y-4">
      {manage ? <WineListSettings key={JSON.stringify(l.settings)} initial={l.settings} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted">{l.count} vin{l.count > 1 ? "s" : ""} à la carte{l.settings.hideOutOfStock ? " (les vins épuisés sont masqués)" : ""}.</p>
        <a href="/api/wine/list/pdf" target="_blank" rel="noopener" className="touch inline-flex h-11 items-center gap-2 rounded-xl surface-2 px-4 text-sm font-bold hover:surface-3" data-testid="wine-list-pdf"><Download className="h-4 w-4" />Télécharger en PDF</a>
      </div>
      <article className="card mx-auto max-w-3xl px-6 py-8 sm:px-10" data-testid="wine-list-preview">
        <h2 className="text-center font-serif text-3xl font-bold text-rose-900 dark:text-rose-200">{l.settings.listTitle}</h2>
        {l.settings.listIntro ? <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted">{l.settings.listIntro}</p> : null}
        {!l.count ? <p className="mt-8 text-center text-sm text-muted">Aucun vin en vente. Fixez les prix de vos vins dans la cave (« Formats et prix »).</p> : null}
        {l.sections.map((s) => (
          <section key={s.color} className="mt-8">
            <h3 className="border-b border-line pb-1 font-serif text-lg font-bold uppercase tracking-widest text-rose-900 dark:text-rose-200">{s.title}</h3>
            {s.regions.map((r) => (
              <div key={r.region ?? "-"} className="mt-3">
                {r.region ? <p className="font-serif text-sm italic text-muted">{r.region}</p> : null}
                <ul className="mt-1 space-y-2">
                  {r.wines.map((w) => (
                    <li key={w.id} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
                      <div className="min-w-0 flex-1"><p className="font-serif font-bold">{w.producer ? `${w.producer}, ` : ""}{w.name}{w.vintage ? ` ${w.vintage}` : ""}{w.isOrganic ? <span className="ml-1.5 text-xs font-normal text-emerald-700 dark:text-emerald-300">bio</span> : null}</p>{w.appellation || w.grapes.length ? <p className="font-serif text-xs italic text-muted">{[w.appellation, w.grapes.join(", ")].filter(Boolean).join(" · ")}</p> : null}</div>
                      <p className="flex shrink-0 flex-wrap gap-x-3 text-sm tabular-nums">{w.formats.map((f) => <span key={f.serving}><span className="text-muted">{formatLabel(f)}</span> <b><Money amount={f.priceTtc} currency={currency} /></b></span>)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}

function WineListSettings({ initial }: { initial: WineSettings }) {
  const act = useAction();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Réglages de la carte">
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[16rem_1fr]">
          <Field label="Titre"><Input value={s.listTitle} onChange={(e) => setS({ ...s, listTitle: e.target.value })} maxLength={60} /></Field>
          <Field label="Présentation (facultatif)"><Input value={s.listIntro} onChange={(e) => setS({ ...s, listIntro: e.target.value })} maxLength={400} placeholder="Notre sélection de vignerons…" /></Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <Toggle checked={s.showOnSite} onChange={(v) => setS({ ...s, showOnSite: v })} label="Afficher sur le site du restaurant" />
          <Toggle checked={s.hideOutOfStock} onChange={(v) => setS({ ...s, hideOutOfStock: v })} label="Masquer les vins épuisés" />
        </div>
        <Button loading={busy} onClick={async () => { setBusy(true); await act(() => api.put("/api/wine/settings", s), { success: "Carte des vins enregistrée", invalidate: [["wine", "carte"]] }); setBusy(false); }} data-testid="wine-list-save">Enregistrer</Button>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ Rapport
export function WineReportView() {
  const { timezone } = useSession();
  const today = localDay(new Date(), timezone);
  const [range, setRange] = useState({ from: addDays(today, -29), to: today });
  const q = useQuery({ queryKey: ["wine", "report", range.from, range.to], queryFn: () => api.get<WineReport>(`/api/wine/report?from=${range.from}&to=${range.to}`) });
  const r = q.data;
  const kpi = (label: string, value: React.ReactNode, sub?: React.ReactNode, testId?: string) => (
    <div className="card p-4" data-testid={testId}><p className="text-xs font-semibold uppercase text-muted">{label}</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{value}</p>{sub ? <p className="text-xs text-muted">{sub}</p> : null}</div>
  );
  const maxColor = Math.max(1, ...(r?.byColor ?? []).map((c) => c.revenue));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Du"><Input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></Field>
        <Field label="Au"><Input type="date" value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></Field>
        {[["7 jours", 6], ["30 jours", 29], ["90 jours", 89]].map(([l, d]) => <Button key={l} variant="secondary" onClick={() => setRange({ from: addDays(today, -(d as number)), to: today })}>{l}</Button>)}
      </div>
      {q.isLoading || !r ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {kpi("Ventes de vin", <Money amount={r.totals.revenue} />, `${String(r.totals.litres).replace(".", ",")} litres servis`, "kpi-wine-revenue")}
            {kpi("Marge (HT)", <Money amount={r.totals.margin} />, r.totals.coefficient ? `coefficient ×${String(r.totals.coefficient).replace(".", ",")}` : "coût d'achat à renseigner", "kpi-wine-margin")}
            {kpi("Bouteilles", r.totals.bottles, `${r.totals.glasses} verre${r.totals.glasses > 1 ? "s" : ""} · ${r.totals.carafes} carafe${r.totals.carafes > 1 ? "s" : ""}`)}
            {kpi("Pertes", <Money amount={r.losses.value} />, `${r.losses.discardedBottles} fin${r.losses.discardedBottles > 1 ? "s" : ""} de bouteille jetée${r.losses.discardedBottles > 1 ? "s" : ""}`, "kpi-wine-losses")}
            {kpi("Valeur de la cave", <Money amount={r.cellar.value} />, `${String(r.cellar.bottles).replace(".", ",")} bouteilles · ${r.cellar.references} références`)}
          </div>
          <Card title="Ventes et marges par vin">
            {r.rows.length ? (
              <div className="-mx-4 -my-2 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm" data-testid="wine-report-table">
                  <thead><tr className="text-left text-xs uppercase text-muted"><th className="px-4 py-2">Vin</th><th className="px-2 py-2 text-right">Btl</th><th className="px-2 py-2 text-right">Verres</th><th className="px-2 py-2 text-right">Carafes</th><th className="px-2 py-2 text-right">CA TTC</th><th className="px-2 py-2 text-right">Marge HT</th><th className="px-4 py-2 text-right">Coef.</th></tr></thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {r.rows.map((x) => <tr key={x.wineId}><td className="px-4 py-2"><span className="flex items-center gap-2"><ColorDot color={x.color} /><span className="truncate">{x.label}</span></span></td><td className="px-2 py-2 text-right tabular-nums">{x.bottles || "—"}</td><td className="px-2 py-2 text-right tabular-nums">{x.glasses || "—"}</td><td className="px-2 py-2 text-right tabular-nums">{x.carafes || "—"}</td><td className="px-2 py-2 text-right tabular-nums"><Money amount={x.revenue} /></td><td className="px-2 py-2 text-right tabular-nums"><Money amount={x.margin} /></td><td className="px-4 py-2 text-right tabular-nums">{x.coefficient ? `×${String(x.coefficient).replace(".", ",")}` : "—"}</td></tr>)}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-muted">Aucun vin vendu sur la période.</p>}
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Par couleur">
              {r.byColor.length ? <ul className="space-y-2">{r.byColor.map((c) => <li key={c.color} className="text-sm"><div className="flex justify-between"><span className="flex items-center gap-2"><ColorDot color={c.color} />{c.label}</span><Money amount={c.revenue} /></div><div className="mt-1 h-2 overflow-hidden rounded-full surface-2"><div className="h-full rounded-full" style={{ width: `${(c.revenue / maxColor) * 100}%`, background: WINE_COLOR_DOT[c.color] }} /></div></li>)}</ul> : <p className="text-sm text-muted">Pas encore de ventes.</p>}
            </Card>
            <Card title="Vins dormants">
              {r.cellar.dormant.length ? <><p className="mb-2 text-xs text-muted">En cave, sans vente sur la période : à mettre en avant (au verre, en accord, sur l&apos;ardoise).</p><ul className="space-y-1.5">{r.cellar.dormant.map((d) => <li key={d.id} className="flex items-center gap-2 text-sm"><span className="min-w-0 flex-1 truncate">{d.label}</span><span className="text-muted">{bottlesLabel(d.bottles)}</span><Money amount={d.value} className="w-24 text-right" /></li>)}</ul></> : <p className="text-sm text-muted">Tous les vins en cave se sont vendus sur la période.</p>}
            </Card>
            <Card title="À commander">
              {r.cellar.low.length ? <ul className="space-y-1.5">{r.cellar.low.map((w) => <li key={w.id} className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-corail-500" /><span className="min-w-0 flex-1 truncate">{w.label}</span><span className="text-muted">{bottlesLabel(w.bottles)} / seuil {bottlesLabel(w.minBottles)}</span></li>)}</ul> : <p className="text-sm text-muted">Tout est au-dessus du seuil.</p>}
            </Card>
            <Card title="Casse, pertes et dégustations">
              {r.losses.rows.length ? <ul className="space-y-1.5">{r.losses.rows.map((l, i) => <li key={i} className="flex items-baseline gap-2 text-sm"><span className="min-w-0 flex-1"><b>{l.name}</b> · {String(l.bottles).replace(".", ",")} btl · {l.reason}<span className="block text-xs text-muted">{formatDateTime(l.at, timezone)}{l.by ? ` · ${l.by}` : ""}</span></span><Money amount={l.value} /></li>)}</ul> : <p className="text-sm text-muted">Aucune perte enregistrée.</p>}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Conseil (caisse)
/** Pour l'équipe en salle : retrouver un vin, ses notes et ses accords pour conseiller le client. */
export function WineAdvisor() {
  const q = useWines();
  const [search, setSearch] = useState("");
  const [color, setColor] = useState<WineColor | "ALL">("ALL");
  const [sheet, setSheet] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  const s = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((w) => w.formats.some((f) => f.isActive) && (color === "ALL" || w.color === color)
    && (!s || [w.label, w.appellation, w.region, w.grapes.join(" "), w.pairingNotes, w.tastingNotes].filter(Boolean).join(" ").toLowerCase().includes(s)));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-72 max-w-full"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Un plat, un cépage, une région…" className="pl-9" aria-label="Rechercher un vin" data-testid="advisor-search" /></div>
        <div className="flex flex-wrap gap-1.5">{(["ALL", ...WINE_COLORS.filter((c) => (q.data ?? []).some((w) => w.color === c))] as const).map((c) => <button key={c} type="button" onClick={() => setColor(c)} aria-pressed={color === c} className={`touch flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${color === c ? "bg-rose-800 text-white" : "surface-2"}`}>{c !== "ALL" ? <ColorDot color={c} /> : null}{c === "ALL" ? "Tous" : WINE_COLOR_LABEL[c]}</button>)}</div>
      </div>
      {!rows.length ? <p className="rounded-2xl surface-2 px-4 py-10 text-center text-sm text-muted">{q.data?.length ? "Aucun vin ne correspond." : "La cave à vin n'a pas encore de vins à la carte."}</p> : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((w) => (
          <button key={w.id} type="button" onClick={() => setSheet(w.id)} className="card touch flex min-w-0 flex-col gap-1.5 p-3 text-left transition hover:shadow-lift" data-testid="advisor-card">
            <span className="flex items-center gap-2"><ColorDot color={w.color} /><span className="min-w-0 flex-1 truncate font-semibold">{w.label}</span>{w.out ? <span className="text-[11px] font-bold text-red-600">épuisé</span> : null}</span>
            <span className="block truncate text-xs text-muted">{[...new Set([w.appellation, w.region, w.grapes.join(", ")].filter(Boolean))].join(" · ")}</span>
            {w.pairingNotes ? <span className="line-clamp-2 text-xs"><WineIcon className="mr-1 inline h-3 w-3 text-rose-700" />{w.pairingNotes}</span> : null}
            <span className="mt-auto flex flex-wrap gap-x-3 text-xs tabular-nums">{w.formats.filter((f) => f.isActive).map((f) => <span key={f.productId} className={f.available ? "" : "line-through opacity-50"}><span className="text-muted">{formatLabel(f)}</span> <b><Money amount={f.priceTtc} /></b></span>)}</span>
          </button>
        ))}
      </div>
      {sheet ? <WineSheet id={sheet} manage={false} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
