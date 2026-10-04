"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, CheckCircle2, Clock, GraduationCap, MonitorPlay, PartyPopper, Printer, Send, Sparkles, Wallet, Wrench, X, Boxes } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { PageHeader, useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { formatDate } from "@/lib/dates";
import { isOptionKey, type OptionKey } from "@/lib/options";
import { GOALS, OPTION_HOME, OPTION_PITCH, recommendedFor, type Goal } from "@/lib/option-pitch";
import { optionCover, optionShotUrl } from "@/lib/option-shots";
import { openLiveDemo } from "@/components/demo-visit";
import { OPTION_LOOK, optionPrice } from "@/components/admin/option-look";
import { OptionViewer } from "@/components/admin/option-viewer";
import { OptionCard, useOptionCatalog, useTryDemo, type CatalogOption } from "@/components/admin/options-catalog";

const BASE = ["Caisse et encaissement (espèces, carte, addition partagée)", "Plan de salle ou vente au comptoir", "Réservations par téléphone, liste du jour et calendrier", "Écran cuisine et bons imprimés", "Tickets, clôture de caisse et rapports du jour"];
const KIND = { snack: "snack", restaurant: "restaurant", bar: "bar" } as const;

/**
 * Options payantes, présentées comme une vitrine : ce qui est conseillé pour cet établissement, tout le catalogue
 * filtré par besoin, une visionneuse par option, et une sélection de plusieurs options demandées en une fois.
 */
export default function OptionsPage() {
  const { me, businessType } = useSession();
  const catalog = useOptionCatalog();
  const tryDemo = useTryDemo();
  const [goal, setGoal] = useState<Goal | "all">("all");
  const [selection, setSelection] = useState<OptionKey[]>([]);
  const [viewing, setViewing] = useState<{ key: OptionKey; origin: DOMRect | null } | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<CatalogOption[] | null>(null);
  const demo = !!me?.isDemo;
  const list = useMemo(() => catalog.data ?? [], [catalog.data]);
  // Sur le restaurant exemple, tout est ouvert : la page présente quand même toutes les options
  const toDiscover = list.filter((o) => demo || !o.enabled);
  const active = demo ? [] : list.filter((o) => o.enabled);
  const recommended = recommendedFor(businessType, demo ? [] : list.filter((o) => o.enabled || o.requestedAt).map((o) => o.key));
  const shown = toDiscover.filter((o) => goal === "all" || OPTION_PITCH[o.key].goal === goal);
  const viewed = viewing ? list.find((o) => o.key === viewing.key) ?? null : null;
  const picked = list.filter((o) => selection.includes(o.key));
  const total = picked.every((o) => o.monthly !== null) ? picked.reduce((a, o) => a + (o.monthly ?? 0), 0) : null;
  const toggle = (k: OptionKey) => setSelection((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const selectable = (o: CatalogOption) => !demo && !o.enabled && !o.requestedAt;

  // Lien direct vers une option : /admin/options?voir=bar
  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get("voir");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture unique de l'adresse au chargement
    if (k && isOptionKey(k)) setViewing({ key: k, origin: null });
  }, []);

  const send = async () => {
    setSending(true);
    const r = await catalog.request(selection);
    setSending(false);
    if (r) { setSent(picked); setSelection([]); }
  };

  if (catalog.isLoading) return <Spinner />;
  return (
    <div className={`mx-auto max-w-6xl ${selection.length ? "pb-28" : ""}`}>
      <PageHeader title="Options" subtitle="Ce qui est actif, et tout ce que vous pouvez ajouter à votre programme." />
      {/* Vitrine : accroche et aperçu des écrans */}
      <section className="relative mb-6 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0b2a3c] via-[#134e5e] to-[#4c1d95] p-6 text-white shadow-lift sm:p-8" data-testid="options-hero">
        <span aria-hidden className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-fuchsia-500/30 blur-3xl" />
        <span aria-hidden className="absolute -bottom-24 left-1/3 h-72 w-72 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="relative grid items-center gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-cyan-200"><Sparkles className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />Options ManaResto</p>
            <h1 className="mt-2 text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Faites grandir votre {KIND[businessType]}</h1>
            <p className="mt-3 max-w-xl text-white/85">Ajoutez seulement ce qui vous fait gagner du temps ou des clients. Chaque option se découvre ici en images et s&apos;active sans rien réinstaller.</p>
            <div className="mt-4 flex flex-wrap gap-2 text-sm font-bold">
              {!demo && active.length ? <span className="rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/20">{active.length} option{active.length > 1 ? "s" : ""} active{active.length > 1 ? "s" : ""}</span> : null}
              <span className="rounded-full bg-white/15 px-3 py-1.5 ring-1 ring-white/20">{toDiscover.length} à découvrir</span>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <a href="#catalogue" className="touch inline-flex h-12 items-center gap-2 rounded-full bg-white px-5 text-sm font-extrabold text-slate-900 shadow-lift hover:bg-white/90">Découvrir les options<ArrowRight className="h-4 w-4" /></a>
              {!demo ? <button type="button" onClick={() => openLiveDemo().catch(() => {})} className="touch inline-flex h-12 items-center gap-2 rounded-full bg-white/10 px-5 text-sm font-extrabold text-white ring-1 ring-white/30 hover:bg-white/20" data-testid="hero-live"><MonitorPlay className="h-4 w-4" />Tout voir en vrai sur le restaurant exemple</button> : null}
            </div>
          </div>
          {/* Collage de trois écrans, comme posés sur la table */}
          <div aria-hidden className="relative hidden h-64 lg:block">
            {(recommended.length >= 3 ? recommended : (["digital", "bar", "wine"] as OptionKey[])).slice(0, 3).map((k, n) => (
              // eslint-disable-next-line @next/next/no-img-element -- capture statique (public/options)
              <img key={k} src={optionShotUrl(k, optionCover(k))} alt="" className="absolute w-[62%] rounded-2xl shadow-2xl ring-1 ring-white/20 transition duration-700 hover:z-10 hover:scale-105"
                style={{ left: `${n * 19}%`, top: `${[18, 0, 30][n]}%`, transform: `rotate(${[-6, 2, 7][n]}deg)`, zIndex: [1, 3, 2][n] }} />
            ))}
          </div>
        </div>
      </section>

      {/* Conseillé pour ce type d'établissement */}
      {recommended.length && !demo ? (
        <section className="mb-8" data-testid="options-recommended">
          <h2 className="text-xl font-extrabold tracking-tight">Recommandé pour votre {KIND[businessType]}</h2>
          <p className="mb-3 text-sm text-muted">Ce que choisissent d&apos;abord les établissements comme le vôtre pour gagner du temps et des clients.</p>
          <div className="grid gap-4 md:grid-cols-3">
            {recommended.map((k) => { const o = list.find((x) => x.key === k)!; return <OptionCard key={k} testPrefix="reco" option={o} recommended selected={selection.includes(k)} onToggle={selectable(o) ? () => toggle(k) : undefined} onOpen={(origin) => setViewing({ key: k, origin })} />; })}
          </div>
        </section>
      ) : null}

      {/* Tout le catalogue, filtré par besoin */}
      <section id="catalogue" className="scroll-mt-6">
        <h2 className="text-xl font-extrabold tracking-tight">{demo ? "Toutes les options, ouvertes sur le restaurant exemple" : "Toutes les options"}</h2>
        <div className="mb-1 mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Besoin">
          {(["all", ...(Object.keys(GOALS) as Goal[])] as const).map((g) => (
            <button key={g} type="button" onClick={() => setGoal(g)} aria-pressed={goal === g} className={`touch h-10 rounded-full px-4 text-sm font-bold transition ${goal === g ? "bg-brand text-white shadow-glow" : "surface-2 text-muted hover:text-[var(--text)]"}`} data-testid={`goal-${g}`}>{g === "all" ? "Tout" : GOALS[g].label}</button>
          ))}
        </div>
        <p className="mb-4 min-h-5 text-sm text-muted">{goal !== "all" ? GOALS[goal].hint : demo ? "Touchez une option pour la voir en images, ou ouvrez-la pour l'essayer sur le restaurant exemple." : "Touchez une option pour la voir en images, ajoutez-en une ou plusieurs à votre sélection."}</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((o) => <OptionCard key={o.key} option={o} recommended={recommended.includes(o.key)} selected={selection.includes(o.key)} onToggle={selectable(o) ? () => toggle(o.key) : undefined} onOpen={(origin) => setViewing({ key: o.key, origin })} />)}
        </div>
        {!shown.length ? <p className="rounded-2xl surface-2 px-4 py-8 text-center text-sm text-muted">{toDiscover.length ? "Rien dans cette catégorie qui ne soit déjà actif." : "Toutes les options sont actives : merci de votre confiance !"}</p> : null}
      </section>

      {/* Options déjà actives */}
      {active.length ? (
        <section className="mt-8" data-testid="options-active">
          <h2 className="mb-3 text-xl font-extrabold tracking-tight">Vos options actives</h2>
          <div className="flex flex-wrap gap-2">
            {active.map((o) => { const L = OPTION_LOOK[o.key]; return (
              <Link key={o.key} href={OPTION_HOME[o.key]} className="card touch inline-flex items-center gap-2.5 py-2 pl-2 pr-4 text-sm font-bold transition hover:shadow-lift" data-testid={`active-${o.key}`}>
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br text-white ${L.tile}`}><L.icon className="h-4 w-4" /></span>{o.label}<CheckCircle2 className="h-4 w-4 text-green-600" />
              </Link>
            ); })}
          </div>
        </section>
      ) : null}

      <section className="card mt-8 flex flex-col gap-3 p-5 sm:flex-row sm:items-center" data-testid="base-program">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-lagon-400 to-lagon-600 text-white shadow-glow"><Wallet className="h-6 w-6" /></span>
        <div className="flex-1">
          <p className="text-base font-extrabold">Programme de base <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-bold text-green-700 dark:text-green-400"><CheckCircle2 className="h-3.5 w-3.5" />toujours inclus</span></p>
          <ul className="mt-1 grid gap-x-5 gap-y-0.5 text-sm text-muted sm:grid-cols-2">{BASE.map((b) => <li key={b} className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />{b}</li>)}</ul>
        </div>
      </section>
      <p className="mt-4 text-center text-xs text-muted">Une demande envoyée, l&apos;équipe ManaResto vous recontacte pour convenir de l&apos;activation.</p>
      <Services />

      {/* Sélection : plusieurs options demandées en une fois */}
      {selection.length ? (
        <div className="fixed inset-x-0 bottom-24 z-30 flex justify-center px-3 lg:left-[268px]" data-testid="selection-bar">
          <div className="rise flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-3xl bg-slate-900 p-3 pl-4 text-white shadow-2xl ring-1 ring-white/10">
            <span className="flex -space-x-2">{picked.map((o) => { const L = OPTION_LOOK[o.key]; return <span key={o.key} className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ring-2 ring-slate-900 ${L.tile}`} title={o.label}><L.icon className="h-4 w-4" /></span>; })}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-extrabold">{selection.length} option{selection.length > 1 ? "s" : ""} sélectionnée{selection.length > 1 ? "s" : ""}</span>
              <span className="block truncate text-xs text-white/70">{total !== null ? `${optionPrice(total)} au total` : picked.map((o) => o.label).join(" · ")}</span>
            </span>
            <button type="button" onClick={() => setSelection([])} className="touch flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/10" aria-label="Vider la sélection"><X className="h-5 w-5" /></button>
            <Button onClick={send} loading={sending} data-testid="selection-send"><Send className="h-4 w-4" />Envoyer ma demande</Button>
          </div>
        </div>
      ) : null}

      {viewed ? (
        <OptionViewer option={viewed} icon={OPTION_LOOK[viewed.key].icon} tile={OPTION_LOOK[viewed.key].tile} price={optionPrice} origin={viewing!.origin}
          selected={selection.includes(viewed.key)} onToggleSelect={selectable(viewed) ? () => toggle(viewed.key) : undefined}
          onTryDemo={() => tryDemo(viewed.key)} onClose={() => setViewing(null)} />
      ) : null}

      {sent ? (
        <Modal open onClose={() => setSent(null)} size="sm" footer={<Button size="lg" className="w-full" onClick={() => setSent(null)}>Parfait</Button>}>
          <div className="flex flex-col items-center py-2 text-center" data-testid="selection-sent">
            <span className="rise flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-lagon-600 text-white shadow-glow"><PartyPopper className="h-8 w-8" /></span>
            <h2 className="mt-4 text-xl font-extrabold">Demande envoyée !</h2>
            <p className="mt-1 text-sm text-muted">L&apos;équipe ManaResto vous recontacte rapidement pour activer :</p>
            <ul className="mt-3 flex flex-wrap justify-center gap-1.5">{sent.map((o) => <li key={o.key} className="rounded-full surface-2 px-3 py-1 text-sm font-bold">{o.label}</li>)}</ul>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

type Service = { key: string; label: string; tagline: string; includes: string[]; price: number | null; requestedAt: string | null; doneAt: string | null };
const SERVICE_ICON: Record<string, typeof Boxes> = { menu_setup: BookOpen, onsite_setup: Wrench, training: GraduationCap, hardware_pack: Printer };

/** Services ponctuels (facturés une fois) : demandés ici, réalisés par l'équipe ManaResto. */
function Services() {
  const act = useAction();
  const q = useQuery({ queryKey: ["services"], queryFn: () => api.get<Service[]>("/api/options/services") });
  const [asking, setAsking] = useState<Service | null>(null);
  const [note, setNote] = useState("");
  const send = async () => {
    if (!asking) return;
    const r = await act(() => api.post("/api/options/services/request", { service: asking.key, note: note || null }), { success: "Demande envoyée : l'équipe ManaResto vous recontacte rapidement", invalidate: [["services"]] });
    if (r) { setAsking(null); setNote(""); }
  };
  if (!q.data?.length) return null;
  return (
    <section className="mt-8" data-testid="services">
      <h2 className="text-xl font-extrabold tracking-tight">Services ponctuels</h2>
      <p className="mb-4 text-sm text-muted">Un coup de main de l&apos;équipe ManaResto pour démarrer sereinement, facturé une seule fois.</p>
      <div className="grid gap-4 md:grid-cols-2">
        {q.data.map((sv) => {
          const I = SERVICE_ICON[sv.key] ?? Sparkles;
          return (
            <article key={sv.key} className="card flex flex-col p-5" data-testid={`service-${sv.key}`}>
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-lift"><I className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1"><h3 className="text-base font-extrabold">{sv.label}</h3><p className="text-sm text-muted">{sv.tagline}</p></div>
              </div>
              <ul className="mt-3 flex-1 space-y-1 text-sm">{sv.includes.map((i) => <li key={i} className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />{i}</li>)}</ul>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                <span className="text-sm font-bold">{sv.price !== null ? `${sv.price.toLocaleString("fr-FR").replace(/ /g, " ")} F CFP (une fois)` : <span className="text-muted">Prix sur demande</span>}</span>
                {sv.requestedAt ? <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-3 py-1.5 text-xs font-bold text-orange-700 dark:text-orange-300"><Clock className="h-4 w-4" />Demandé le {formatDate(sv.requestedAt, "Pacific/Tahiti")}</span>
                  : <Button variant="secondary" onClick={() => setAsking(sv)}>{sv.doneAt ? "Redemander" : "Demander"}</Button>}
              </div>
            </article>
          );
        })}
      </div>
      {asking ? (
        <Modal open onClose={() => setAsking(null)} size="sm" title={asking.label} footer={<Button size="lg" className="w-full" onClick={send} data-testid="service-send">Envoyer la demande</Button>}>
          <p className="mb-3 text-sm text-muted">L&apos;équipe ManaResto vous recontacte pour convenir du jour et des détails.</p>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Précisions utiles : nombre de plats, de tablettes, d'employés, vos disponibilités…" aria-label="Précisions" />
        </Modal>
      ) : null}
    </section>
  );
}
