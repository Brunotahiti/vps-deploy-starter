"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Martini, Plus, Search, Sparkles, Wine, GlassWater, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";
import { Empty, Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { formatElapsed } from "@/lib/dates";
import { isHappyHourOn, type BarSettings } from "@/lib/happy-hour";
import { doseLabel, stockLabel, type Bottle, type Cocktail, type Tab } from "./types";
import { OptionPromo } from "@/components/admin/options-catalog";

type View = "tabs" | "cards" | "breakage";
const BREAK_REASONS = ["Bouteille cassée", "Verre renversé", "Périmé", "Erreur de préparation"];

/** Écran Bar de la caisse (option Bar) : ardoises ouvertes au comptoir, fiches cocktails, casse. */
export function PosBar() {
  const { can, hasOption, timezone } = useSession();
  const allowed = hasOption("bar") && (can("bar.use") || can("bar.manage"));
  const [view, setView] = useState<View>("tabs");
  // Rechargée à chaque ouverture : une ardoise réglée à l'instant ne doit pas réapparaître
  const tabs = useQuery({ queryKey: ["bar", "tabs"], queryFn: () => api.get<Tab[]>("/api/bar/tabs"), enabled: allowed, refetchInterval: 15_000, refetchOnMount: "always" });
  const settings = useQuery({ queryKey: ["bar", "settings"], queryFn: () => api.get<BarSettings>("/api/bar/settings"), enabled: allowed, refetchInterval: 60_000 });
  if (!allowed) return <div className="overflow-y-auto p-4">{hasOption("bar") ? <Empty title="Bar" hint="Votre profil n'a pas accès à cet écran." /> : <OptionPromo option="bar" />}</div>;

  // Happy hour en cours (le plus avantageux), pour le rappeler à l'équipe
  const now = new Date();
  const live = (settings.data?.happyHours ?? []).filter((h) => isHappyHourOn(h, timezone, now));
  const views: { key: View; label: string; icon: typeof Wine }[] = [
    { key: "tabs", label: `Ardoises${tabs.data?.length ? ` (${tabs.data.length})` : ""}`, icon: Wine },
    { key: "cards", label: "Fiches cocktails", icon: Martini },
    { key: "breakage", label: "Casse", icon: AlertTriangle },
  ];
  return (
    <div className="mx-auto max-w-5xl overflow-y-auto p-4">
      {live.length ? (
        <div className="mb-3 flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-rose-500 px-4 py-3 text-white shadow-glow" data-testid="happy-hour-live">
          <Sparkles className="h-5 w-5 shrink-0" />
          <p className="text-sm font-bold">{live.map((h) => `${h.name} en cours : −${Math.round(h.discountBps / 100)} % jusqu'à ${h.end.replace(":", " h ")}`).join(" · ")}</p>
        </div>
      ) : null}
      <div role="tablist" className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {views.map((v) => (
          <button key={v.key} role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)} className={`touch flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-4 text-sm font-bold ${view === v.key ? "bg-lagon-600 text-white" : "surface-2"}`}><v.icon className="h-4 w-4" />{v.label}</button>
        ))}
      </div>
      {view === "tabs" ? <Tabs tabs={tabs.data} loading={tabs.isLoading} canOpen={can("pos.use")} /> : null}
      {view === "cards" ? <Cards /> : null}
      {view === "breakage" ? <Breakage /> : null}
    </div>
  );
}

function Tabs({ tabs, loading, canOpen }: { tabs?: Tab[]; loading: boolean; canOpen: boolean }) {
  const router = useRouter();
  const act = useAction();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy || !name.trim()) return;
    setBusy(true);
    const id = crypto.randomUUID();
    const r = await act(() => api.post("/api/bar/tabs", { id, name: name.trim() }), { invalidate: [["bar", "tabs"]] });
    setBusy(false);
    if (r) router.push(`/pos/order/${id}`);
  };
  const list = (tabs ?? []).filter((t) => !search || (t.customerName ?? "").toLowerCase().includes(search.toLowerCase()));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {canOpen ? <Button size="lg" onClick={() => { setName(""); setCreating(true); }} data-testid="tab-new"><Plus className="h-5 w-5" />Nouvelle ardoise</Button> : null}
        {(tabs?.length ?? 0) > 6 ? <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-xl surface-2 px-3"><Search className="h-4 w-4 text-muted" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher un nom…" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" /></label> : null}
      </div>
      {loading ? <div className="flex justify-center py-10"><Spinner /></div> : null}
      {!loading && !tabs?.length ? <p className="rounded-2xl surface-2 px-4 py-10 text-center text-sm text-muted">Aucune ardoise ouverte. Une ardoise garde les consommations d&apos;un client au comptoir ; il règle tout en partant.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {list.map((t) => (
          <Link key={t.id} href={`/pos/order/${t.id}`} className="card touch flex flex-col gap-1 p-4 hover:shadow-lift" data-testid="tab-card">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-xl font-extrabold">{t.customerName}</p>
              <Money amount={t.total} className="shrink-0 text-xl font-extrabold" />
            </div>
            <p className="text-sm text-muted">{t.items} article{t.items > 1 ? "s" : ""} · ouverte il y a {formatElapsed(t.openedAt)}{t.server ? ` · ${t.server}` : ""}</p>
            {t.status === "BILL_REQUESTED" ? <span className="mt-1 self-start rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">Addition demandée</span> : null}
            {t.paidTotal > 0 ? <span className="text-xs font-semibold text-lagon-600">Déjà réglé : <Money amount={t.paidTotal} /></span> : null}
          </Link>
        ))}
      </div>
      {creating ? (
        <Modal open onClose={() => setCreating(false)} size="sm" title="Nouvelle ardoise" footer={<Button size="lg" className="w-full" loading={busy} disabled={!name.trim()} onClick={open} data-testid="tab-open">Ouvrir l&apos;ardoise</Button>}>
          <Field label="Nom du client" hint="Le prénom suffit : il apparaît sur l'ardoise et sur le ticket.">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && open()} maxLength={60} placeholder="Teva, table du fond…" data-testid="tab-name" />
          </Field>
        </Modal>
      ) : null}
    </div>
  );
}

/** Fiches cocktails à consulter au bar : verre, doses, garniture, préparation. */
export function CocktailCard({ c }: { c: Cocktail }) {
  return (
    <article className="card p-4" data-testid="cocktail-card">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-extrabold">{c.name}</h3>
        {c.spec?.glass ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full surface-2 px-2.5 py-1 text-xs font-bold"><GlassWater className="h-3.5 w-3.5" />{c.spec.glass}</span> : null}
      </div>
      {c.doses.length ? (
        <ul className="mt-2 space-y-1">{c.doses.map((d) => <li key={d.ingredientId} className="flex items-baseline gap-2 text-sm"><span className="w-20 shrink-0 text-right font-extrabold tabular-nums text-lagon-700 dark:text-lagon-300">{doseLabel(d)}</span><span>{d.name}</span></li>)}</ul>
      ) : null}
      {c.spec?.garnish ? <p className="mt-2 text-sm"><span className="font-bold">Garniture : </span>{c.spec.garnish}</p> : null}
      {c.spec?.method ? <p className="mt-1 whitespace-pre-line text-sm text-muted">{c.spec.method}</p> : null}
    </article>
  );
}

function Cards() {
  const q = useQuery({ queryKey: ["bar", "cocktails"], queryFn: () => api.get<Cocktail[]>("/api/bar/cocktails") });
  const [search, setSearch] = useState("");
  const list = useMemo(() => (q.data ?? []).filter((c) => c.hasCard && (!search || c.name.toLowerCase().includes(search.toLowerCase()))), [q.data, search]);
  if (q.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!(q.data ?? []).some((c) => c.hasCard)) return <p className="rounded-2xl surface-2 px-4 py-10 text-center text-sm text-muted">Aucune fiche pour l&apos;instant : votre responsable les rédige dans Gestion → Bar → Fiches cocktails.</p>;
  return (
    <div>
      <label className="mb-3 flex h-12 items-center gap-2 rounded-xl surface-2 px-3"><Search className="h-4 w-4 text-muted" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Chercher un cocktail…" className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map((c) => <CocktailCard key={c.id} c={c} />)}</div>
    </div>
  );
}

function Breakage() {
  const act = useAction();
  const cellar = useQuery({ queryKey: ["bar", "cellar"], queryFn: () => api.get<Bottle[]>("/api/bar/cellar") });
  const [id, setId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [per, setPer] = useState<"bottle" | "unit">("bottle");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const bottle = cellar.data?.find((b) => b.id === id);
  const save = async () => {
    setBusy(true);
    const r = await act(() => api.post<Bottle>(`/api/bar/cellar/${id}/breakage`, { quantity: Number(quantity.replace(",", ".")), per: bottle?.unit === "cl" ? per : "bottle", reason: reason.trim() }), { success: "Casse enregistrée", invalidate: [["bar", "cellar"]] });
    setBusy(false);
    if (r) { setQuantity("1"); setReason(""); }
  };
  if (cellar.isLoading) return <div className="flex justify-center py-10"><Spinner /></div>;
  if (!cellar.data?.length) return <p className="rounded-2xl surface-2 px-4 py-10 text-center text-sm text-muted">La cave du bar est vide : votre responsable ajoute les bouteilles dans Gestion → Bar → Cave du bar.</p>;
  return (
    <section className="card max-w-lg space-y-3 p-4">
      <p className="text-sm text-muted">Une bouteille cassée, un verre renversé : notez-le ici pour que la cave reste juste. Votre responsable le retrouve dans le rapport du bar.</p>
      <Field label="Boisson"><Select value={id} onChange={(e) => setId(e.target.value)} data-testid="breakage-bottle"><option value="">Choisir…</option>{cellar.data.map((b) => <option key={b.id} value={b.id}>{b.name} ({stockLabel(b)})</option>)}</Select></Field>
      <div className="flex gap-2">
        <Field label="Quantité" className="w-28"><Input inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
        {bottle?.unit === "cl" ? (
          <Field label="En" className="flex-1"><div className="flex gap-1.5">{(["bottle", "unit"] as const).map((p) => <button key={p} type="button" onClick={() => setPer(p)} className={`touch h-11 flex-1 rounded-xl text-sm font-bold ${per === p ? "bg-lagon-600 text-white" : "surface-2"}`}>{p === "bottle" ? "Bouteilles" : "cl"}</button>)}</div></Field>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">{BREAK_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={`touch h-9 rounded-full px-3 text-xs font-semibold ${reason === r ? "bg-corail-500 text-white" : "surface-2"}`}>{r}</button>)}</div>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif" aria-label="Motif de la casse" maxLength={120} />
      <Button size="lg" className="w-full" variant="danger" loading={busy} disabled={!id || !(Number(quantity.replace(",", ".")) > 0) || reason.trim().length < 2} onClick={save} data-testid="breakage-save">Enregistrer la casse</Button>
    </section>
  );
}
