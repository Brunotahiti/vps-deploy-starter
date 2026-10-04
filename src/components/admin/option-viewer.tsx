"use client";
/* eslint-disable @next/next/no-img-element -- captures d'écran statiques (public/options), déjà au bon format */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, MonitorPlay, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { OPTION_SHOTS, optionCover, optionShotUrl } from "@/lib/option-shots";
import type { OptionKey } from "@/lib/options";
import { OPTION_PITCH } from "@/lib/option-pitch";

export type ViewerOption = { key: OptionKey; label: string; tagline: string; includes: string[]; enabled: boolean; monthly: number | null; requestedAt: string | null };

const EASE_OUT = "cubic-bezier(.16,1,.3,1)"; // départ vif, arrivée tout en douceur
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Transformation qui ramène le panneau sur la carte de l'option touchée (point de départ de l'animation). */
function fromOrigin(panel: DOMRect, origin: DOMRect | null) {
  if (!origin || !panel.width) return "translateY(32px) scale(.92)";
  const dx = origin.left + origin.width / 2 - (panel.left + panel.width / 2);
  const dy = origin.top + origin.height / 2 - (panel.top + panel.height / 2);
  const k = Math.min(0.9, Math.max(0.3, origin.width / panel.width));
  return `translate(${dx}px, ${dy}px) scale(${k})`;
}

/**
 * Visionneuse d'une option payante : captures d'écran du restaurant exemple, avec légendes.
 * Elle jaillit de la carte touchée et y retourne à la fermeture ; les images glissent l'une après l'autre.
 * Flèches, glisser du doigt, vignettes et clavier (← → Échap) ; le bouton « Débloquer » reste à portée.
 */
export function OptionViewer({ option, icon: Icon, tile, price, origin = null, onUnlock, onClose, selected, onToggleSelect, onTryDemo }: {
  option: ViewerOption; icon: React.ComponentType<{ className?: string }>; tile: string; price: (n: number) => string;
  origin?: DOMRect | null; onUnlock?: () => Promise<unknown>; onClose: () => void;
  /** Sélection de plusieurs options (page Options) */
  selected?: boolean; onToggleSelect?: () => void;
  /** Ouvrir l'écran de l'option dans le restaurant exemple */
  onTryDemo?: () => void;
}) {
  const shots = OPTION_SHOTS[option.key] ?? [];
  const [i, setI] = useState(() => optionCover(option.key));
  const [busy, setBusy] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const dir = useRef(1);
  const closing = useRef(false);
  const go = useCallback((d: number) => { dir.current = d; setI((v) => (shots.length ? (v + d + shots.length) % shots.length : 0)); }, [shots.length]);

  // Ouverture : le fond s'assombrit, le panneau grandit depuis la carte, puis le contenu apparaît en cascade
  useLayoutEffect(() => {
    const b = backdrop.current, p = panel.current;
    if (!b || !p) return;
    if (reducedMotion()) { b.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 }); return; }
    b.animate([{ opacity: 0, backdropFilter: "blur(0px)" }, { opacity: 1, backdropFilter: "blur(6px)" }], { duration: 320, easing: "ease-out" });
    p.animate([{ opacity: 0, transform: fromOrigin(p.getBoundingClientRect(), origin), borderRadius: "40px" }, { opacity: 1, offset: 0.35 }, { opacity: 1, transform: "none" }], { duration: 560, easing: EASE_OUT });
    p.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el, k) => el.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay: 220 + k * 70, easing: EASE_OUT, fill: "backwards" }));
    stage.current?.querySelector<HTMLElement>("[data-active]")?.animate([{ transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 900, easing: EASE_OUT });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seulement à l'ouverture
  }, []);

  // Changement d'image : la nouvelle glisse dans le sens choisi
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (reducedMotion()) return;
    stage.current?.querySelector<HTMLElement>("[data-active]")?.animate([{ opacity: 0.4, transform: `translateX(${dir.current * 48}px) scale(1.02)` }, { opacity: 1, transform: "none" }], { duration: 380, easing: EASE_OUT });
  }, [i]);

  // Fermeture : le panneau retourne vers sa carte en s'effaçant
  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const b = backdrop.current, p = panel.current;
    if (!b || !p || reducedMotion()) { onClose(); return; }
    b.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: "ease-in", fill: "forwards" });
    p.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: fromOrigin(p.getBoundingClientRect(), origin) }], { duration: 280, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }).finished.then(onClose, onClose);
  }, [onClose, origin]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = overflow; };
  }, [go, close]);

  const unlock = async () => { if (!onUnlock) return; setBusy(true); await onUnlock(); setBusy(false); };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current; touch.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={`${option.label} en images`} onClick={close} data-testid="option-viewer">
      <div ref={backdrop} aria-hidden className="absolute inset-0 bg-slate-950/80 backdrop-blur-[6px]" />
      <div ref={panel} className="relative flex h-full w-full max-w-5xl flex-col overflow-hidden bg-[var(--surface)] shadow-2xl will-change-transform sm:h-auto sm:max-h-[96vh] sm:rounded-[28px]" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5" style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}>
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lift ${tile}`}><Icon className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-extrabold leading-tight">{option.label}</h2>
            <p className="truncate text-sm text-muted">{option.tagline}</p>
          </div>
          <button ref={closeRef} type="button" onClick={close} className="touch flex h-10 w-10 shrink-0 items-center justify-center rounded-xl surface-2 hover:surface-3" aria-label="Fermer"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {shots.length ? (
            <>
              <div ref={stage} className="relative overflow-hidden bg-slate-900" onTouchStart={(e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }} onTouchEnd={onTouchEnd}>
                {/* Sur grand écran, l'image laisse la place à la légende et au bouton sans défiler */}
                <div className="relative mx-auto aspect-[16/10] w-full sm:w-[min(100%,calc(58vh*1.6))]">
                  {shots.map((caption, k) => (
                    <img key={k} src={optionShotUrl(option.key, k)} alt={caption} draggable={false} loading={Math.abs(k - i) <= 1 ? "eager" : "lazy"}
                      className={`absolute inset-0 h-full w-full select-none object-contain transition-opacity duration-300 ${k === i ? "opacity-100" : "pointer-events-none opacity-0"}`}
                      aria-hidden={k !== i} data-active={k === i ? "" : undefined} data-testid={k === i ? "viewer-image" : undefined} />
                  ))}
                </div>
                {shots.length > 1 ? (
                  <>
                    <button type="button" onClick={() => go(-1)} className="touch absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lift transition hover:bg-white sm:left-3" aria-label="Image précédente" data-testid="viewer-prev"><ChevronLeft className="h-6 w-6" /></button>
                    <button type="button" onClick={() => go(1)} className="touch absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lift transition hover:bg-white sm:right-3" aria-label="Image suivante" data-testid="viewer-next"><ChevronRight className="h-6 w-6" /></button>
                    <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-bold tabular-nums text-white" data-testid="viewer-count">{i + 1} / {shots.length}</span>
                  </>
                ) : null}
              </div>
              <p data-reveal className="px-4 pt-3 text-center text-sm font-semibold sm:px-5 sm:text-base" aria-live="polite" data-testid="viewer-caption">{shots[i]}</p>
              {shots.length > 1 ? (
                <div data-reveal className="no-scrollbar flex justify-start gap-2 overflow-x-auto px-4 py-3 sm:justify-center sm:px-5">
                  {shots.map((caption, k) => (
                    <button key={k} type="button" onClick={() => setI(k)} aria-label={`Image ${k + 1} : ${caption}`} aria-current={k === i}
                      className={`touch relative h-14 w-[88px] shrink-0 overflow-hidden rounded-lg ring-2 transition ${k === i ? "ring-lagon-500" : "opacity-60 ring-transparent hover:opacity-100"}`}>
                      <img src={optionShotUrl(option.key, k)} alt="" loading="lazy" className="h-full w-full object-cover object-top" />
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          <ul data-reveal className="grid gap-x-6 gap-y-1 px-4 pb-4 pt-1 text-sm sm:grid-cols-2 sm:px-5">
            {option.includes.map((t) => <li key={t} className="flex items-start gap-2"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />{t}</li>)}
          </ul>
        </div>

        <footer data-reveal className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <span className="min-w-0">
            <span className="block text-sm font-bold">{option.monthly !== null ? price(option.monthly) : <span className="text-muted">Prix sur demande</span>}</span>
            <span className="hidden text-xs text-muted sm:block">{OPTION_PITCH[option.key].benefit}</span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            {onTryDemo && !option.enabled ? <Button variant="ghost" onClick={onTryDemo} data-testid="viewer-try"><MonitorPlay className="h-4 w-4" /><span className="hidden sm:inline">Voir en vrai</span></Button> : null}
            {option.enabled ? <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/10 px-3 py-1.5 text-sm font-bold text-green-700 dark:text-green-400"><CheckCircle2 className="h-4 w-4" />Active</span>
              : option.requestedAt ? <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-500/10 px-3 py-1.5 text-xs font-bold text-orange-700 dark:text-orange-300"><Clock className="h-4 w-4" />Demande envoyée le {formatDate(option.requestedAt, "Pacific/Tahiti")}</span>
              : onToggleSelect ? <Button variant={selected ? "secondary" : "primary"} onClick={onToggleSelect} data-testid="viewer-select">{selected ? <><Check className="h-4 w-4" />Dans ma sélection</> : <><Plus className="h-4 w-4" />Ajouter à ma sélection</>}</Button>
              : onUnlock ? <Button onClick={unlock} loading={busy} data-testid="viewer-unlock"><Sparkles className="h-4 w-4" />Débloquer</Button> : null}
          </span>
        </footer>
      </div>
    </div>
  );
}
