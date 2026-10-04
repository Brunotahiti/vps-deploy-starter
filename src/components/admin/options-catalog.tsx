"use client";
/* eslint-disable @next/next/no-img-element -- captures statiques (public/options), déjà au bon format */

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, CheckCircle2, Clock, Images, MonitorPlay, Plus, Sparkles } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useToast } from "@/components/ui/toast";
import { useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { formatDate } from "@/lib/dates";
import { OPTIONS, type OptionKey } from "@/lib/options";
import { OPTION_SHOTS, optionCover, optionShotUrl } from "@/lib/option-shots";
import { OPTION_HOME, OPTION_PITCH, recommendedFor } from "@/lib/option-pitch";
import { openLiveDemo } from "@/components/demo-visit";
import { OPTION_LOOK, optionPrice } from "./option-look";
import { OptionViewer, type ViewerOption } from "./option-viewer";

export type CatalogOption = ViewerOption;

/** Options de l'entreprise (actives, demandées, prix) et demande d'une ou plusieurs options. */
export function useOptionCatalog(enabled = true) {
  const act = useAction();
  const q = useQuery({ queryKey: ["options"], queryFn: () => api.get<CatalogOption[]>("/api/options"), enabled });
  const request = (keys: OptionKey[]) => act(
    () => api.post("/api/options/request", keys.length === 1 ? { option: keys[0] } : { options: keys }),
    { invalidate: [["options"]] },
  );
  return { ...q, request };
}

/** « Voir en vrai » : l'écran de l'option dans le restaurant exemple (sa propre session est gardée pour revenir). */
export function useTryDemo() {
  const { me } = useSession();
  const { toast } = useToast();
  return async (key: OptionKey) => {
    // Déjà sur le restaurant exemple : simple navigation
    if (me?.isDemo) { window.location.assign(OPTION_HOME[key]); return; }
    try { await openLiveDemo(OPTION_HOME[key]); }
    catch (e) { toast(e instanceof ApiClientError ? e.message : "Restaurant exemple momentanément indisponible", "error"); }
  };
}

/** Carte d'une option : grande capture, promesse, trois points forts, sélection. */
export function OptionCard({ option, recommended, selected, onToggle, onOpen, testPrefix = "option" }: {
  option: CatalogOption; recommended?: boolean; selected?: boolean; onToggle?: () => void; onOpen: (origin: DOMRect | null) => void;
  /** Préfixe des repères de test (« reco » pour la rangée des options conseillées) */
  testPrefix?: string;
}) {
  const L = OPTION_LOOK[option.key];
  const shots = OPTION_SHOTS[option.key] ?? [];
  const more = option.includes.length - 3;
  const open = (e: React.MouseEvent<HTMLElement>) => onOpen(e.currentTarget.closest("article")?.getBoundingClientRect() ?? null);
  return (
    <article className={`group card flex flex-col overflow-hidden transition duration-300 hover:-translate-y-1 hover:shadow-lift ${selected ? "ring-2 ring-lagon-500" : option.enabled ? "ring-2 ring-green-500/40" : ""}`} data-testid={`${testPrefix}-${option.key}`}>
      <button type="button" onClick={open} className="relative block aspect-[16/9] overflow-hidden bg-slate-900 text-left" aria-label={`Voir l'option ${option.label} en images`} data-testid={`${testPrefix}-view-${option.key}`}>
        {shots.length ? <img src={optionShotUrl(option.key, optionCover(option.key))} alt="" loading="lazy" className="h-full w-full object-cover object-top transition duration-700 group-hover:scale-[1.05]" /> : null}
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/20 to-transparent" />
        <span className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {recommended && !option.enabled ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-extrabold text-slate-900 shadow"><Sparkles className="h-3 w-3" />Recommandé</span> : null}
          {option.enabled ? <span className="inline-flex items-center gap-1 rounded-full bg-green-500 px-2.5 py-1 text-[11px] font-extrabold text-white shadow"><CheckCircle2 className="h-3 w-3" />Active</span> : null}
          {selected ? <span className="inline-flex items-center gap-1 rounded-full bg-lagon-500 px-2.5 py-1 text-[11px] font-extrabold text-white shadow"><Check className="h-3 w-3" />Sélectionnée</span> : null}
        </span>
        {shots.length ? <span className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold text-white backdrop-blur"><Images className="h-3.5 w-3.5" />{shots.length}</span> : null}
        <span className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lift ring-2 ring-white/30 ${L.tile}`}><L.icon className="h-5 w-5" /></span>
          <span className="min-w-0 text-white">
            <span className="block text-xl font-extrabold leading-tight drop-shadow">{option.label}</span>
            <span className="block truncate text-sm text-white/80">{option.tagline}</span>
          </span>
        </span>
      </button>
      <div className="flex flex-1 flex-col p-4">
        <p className="font-semibold leading-snug">{OPTION_PITCH[option.key].benefit}</p>
        <ul className="mt-2 flex-1 space-y-1 text-sm text-muted">
          {option.includes.slice(0, 3).map((i) => <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lagon-600" />{i}</li>)}
          {more > 0 ? <li><button type="button" onClick={open} className="text-xs font-bold text-lagon-700 hover:underline dark:text-lagon-300">et {more} autre{more > 1 ? "s" : ""} : tout voir en images</button></li> : null}
        </ul>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <span className="text-sm font-bold">{option.monthly !== null ? optionPrice(option.monthly) : <span className="text-muted">Prix sur demande</span>}</span>
          <span className="flex gap-1.5">
            <Button variant="ghost" onClick={open}><Images className="h-4 w-4" />Voir</Button>
            {option.enabled ? <Link href={OPTION_HOME[option.key]} className="touch inline-flex h-10 items-center gap-1.5 rounded-xl surface-2 px-3 text-sm font-bold hover:surface-3">Ouvrir<ArrowRight className="h-4 w-4" /></Link>
              : option.requestedAt ? <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-3 py-1.5 text-xs font-bold text-orange-700 dark:text-orange-300"><Clock className="h-4 w-4" />Demandée le {formatDate(option.requestedAt, "Pacific/Tahiti")}</span>
              : onToggle ? <Button variant={selected ? "secondary" : "primary"} onClick={onToggle} data-testid={`${testPrefix}-select-${option.key}`}>{selected ? <><Check className="h-4 w-4" />Sélectionnée</> : <><Plus className="h-4 w-4" />Ajouter</>}</Button> : null}
          </span>
        </div>
      </div>
    </article>
  );
}

/**
 * Écran réservé à une option que l'entreprise n'a pas : au lieu d'un message sec, l'option se présente
 * (captures, promesse, points forts) et se demande d'un geste, ou se voit en vrai dans le restaurant exemple.
 */
export function OptionPromo({ option: key }: { option: OptionKey }) {
  const { can, me } = useSession();
  const manage = can("settings.manage");
  const catalog = useOptionCatalog(manage);
  const tryDemo = useTryDemo();
  const [viewing, setViewing] = useState<DOMRect | null | false>(false);
  const [busy, setBusy] = useState(false);
  const base = OPTIONS[key];
  const option: CatalogOption = catalog.data?.find((o) => o.key === key) ?? { key, label: base.label, tagline: base.tagline, includes: [...base.includes], enabled: false, monthly: null, requestedAt: null };
  const L = OPTION_LOOK[key];
  const shots = OPTION_SHOTS[key] ?? [];
  const unlock = async () => { setBusy(true); await catalog.request([key]); setBusy(false); };
  return (
    <div className="mx-auto max-w-5xl" data-testid="option-promo">
      <section className="card grid overflow-hidden lg:grid-cols-[1.25fr_1fr]">
        <button type="button" onClick={(e) => setViewing(e.currentTarget.getBoundingClientRect())} className="group relative aspect-[16/10] overflow-hidden bg-slate-900 lg:aspect-auto" aria-label={`Voir l'option ${base.label} en images`}>
          {shots.length ? <img src={optionShotUrl(key, optionCover(key))} alt="" className="h-full w-full object-cover object-left-top transition duration-700 group-hover:scale-[1.04]" /> : null}
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-slate-950/70 to-transparent" />
          {shots.length ? <span className="absolute bottom-4 left-4 inline-flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-extrabold text-slate-900 shadow-lift"><Images className="h-4 w-4" />Voir en images · {shots.length}</span> : null}
        </button>
        <div className="flex flex-col p-6">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-violet-600 dark:text-violet-300">Option ManaResto</p>
          <div className="mt-2 flex items-center gap-3">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lift ${L.tile}`}><L.icon className="h-6 w-6" /></span>
            <h1 className="text-2xl font-extrabold tracking-tight">{base.label}</h1>
          </div>
          <p className="mt-3 text-lg font-semibold leading-snug">{OPTION_PITCH[key].benefit}</p>
          <ul className="mt-3 flex-1 space-y-1.5 text-sm">{base.includes.map((i) => <li key={i} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-lagon-600" />{i}</li>)}</ul>
          <div className="mt-5 space-y-2">
            {manage ? (
              option.enabled ? <p className="flex items-center gap-1.5 text-sm font-bold text-green-700 dark:text-green-400"><CheckCircle2 className="h-4 w-4" />Option active : rechargez la page.</p>
                : option.requestedAt ? <p className="flex items-center gap-1.5 rounded-xl bg-orange-500/10 px-3 py-2 text-sm font-bold text-orange-700 dark:text-orange-300"><Clock className="h-4 w-4" />Demande envoyée le {formatDate(option.requestedAt, "Pacific/Tahiti")} : l&apos;équipe ManaResto vous recontacte.</p>
                : <Button size="lg" className="w-full" loading={busy} onClick={unlock} data-testid="promo-unlock"><Sparkles className="h-5 w-5" />Débloquer {base.label}</Button>
            ) : <p className="rounded-xl surface-2 px-3 py-2 text-sm text-muted">Demandez à votre responsable de débloquer cette option dans Gestion → Options.</p>}
            <div className="flex flex-wrap gap-2">
              {!me?.isDemo ? <Button variant="secondary" className="flex-1" onClick={() => tryDemo(key)} data-testid="promo-try"><MonitorPlay className="h-4 w-4" />Voir en vrai</Button> : null}
              {manage ? <Link href="/admin/options" className="touch inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl surface-2 px-3 text-sm font-bold hover:surface-3">Toutes les options<ArrowRight className="h-4 w-4" /></Link> : null}
            </div>
            <p className="text-xs text-muted">{option.monthly !== null ? optionPrice(option.monthly) : "Prix sur demande"} · activée par l&apos;équipe ManaResto, sans rien réinstaller.</p>
          </div>
        </div>
      </section>
      {viewing !== false ? <OptionViewer option={option} icon={L.icon} tile={L.tile} price={optionPrice} origin={viewing} onUnlock={manage && !option.enabled && !option.requestedAt ? unlock : undefined} onTryDemo={!me?.isDemo ? () => tryDemo(key) : undefined} onClose={() => setViewing(false)} /> : null}
    </div>
  );
}

/** Tableau de bord : trois options conseillées pour ce type d'établissement, à découvrir en images. */
export function OptionsDiscover() {
  const { can, me, businessType } = useSession();
  const show = can("settings.manage") && !me?.isDemo;
  const catalog = useOptionCatalog(show);
  const tryDemo = useTryDemo();
  const [viewing, setViewing] = useState<{ key: OptionKey; origin: DOMRect | null } | null>(null);
  if (!show) return null;
  if (catalog.isLoading) return <div className="mb-4"><Spinner /></div>;
  const list = catalog.data ?? [];
  const keys = recommendedFor(businessType, list.filter((o) => o.enabled || o.requestedAt).map((o) => o.key));
  if (!keys.length) return null;
  const viewed = viewing ? list.find((o) => o.key === viewing.key) : null;
  return (
    <section className="mb-4 overflow-hidden rounded-3xl border border-violet-500/20 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/5 to-transparent p-4 sm:p-5" data-testid="options-discover">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-violet-600 dark:text-violet-300"><Sparkles className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />À découvrir</p>
          <h2 className="text-lg font-extrabold tracking-tight">Les options conseillées pour votre {businessType === "snack" ? "snack" : businessType === "bar" ? "bar" : "restaurant"}</h2>
        </div>
        <Link href="/admin/options" className="inline-flex items-center gap-1 text-sm font-bold text-violet-700 hover:underline dark:text-violet-300">Toutes les options<ArrowRight className="h-4 w-4" /></Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {keys.map((k) => {
          const o = list.find((x) => x.key === k)!;
          const L = OPTION_LOOK[k];
          return (
            <button key={k} type="button" onClick={(e) => setViewing({ key: k, origin: e.currentTarget.getBoundingClientRect() })} className="group overflow-hidden rounded-2xl bg-[var(--surface)] text-left shadow-soft transition hover:-translate-y-0.5 hover:shadow-lift" data-testid={`discover-${k}`}>
              <span className="relative block aspect-[16/8] overflow-hidden bg-slate-900">
                <img src={optionShotUrl(k, optionCover(k))} alt="" loading="lazy" className="h-full w-full object-cover object-top transition duration-700 group-hover:scale-[1.05]" />
                <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-slate-950/70 to-transparent" />
                <span className="absolute bottom-2 left-3 flex items-center gap-2 text-white"><span className={`flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br ${L.tile}`}><L.icon className="h-4 w-4" /></span><span className="font-extrabold">{o.label}</span></span>
              </span>
              <span className="block p-3 text-sm font-semibold leading-snug">{OPTION_PITCH[k].benefit}</span>
            </button>
          );
        })}
      </div>
      {viewed ? <OptionViewer option={viewed} icon={OPTION_LOOK[viewed.key].icon} tile={OPTION_LOOK[viewed.key].tile} price={optionPrice} origin={viewing!.origin} onUnlock={() => catalog.request([viewed.key])} onTryDemo={() => tryDemo(viewed.key)} onClose={() => setViewing(null)} /> : null}
    </section>
  );
}
