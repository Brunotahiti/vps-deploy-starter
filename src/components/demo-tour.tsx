"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown, Compass, PartyPopper, X } from "lucide-react";
import { useSession } from "@/hooks/use-session";

/**
 * Visite guidée du restaurant exemple : quatre étapes pour voir l'essentiel en deux minutes (salle, commande,
 * cuisine, chiffres). Elle n'apparaît que pour un visiteur arrivé par la démo (lien du site vitrine, bouton
 * « Restaurant exemple ») : jamais sur un vrai compte, ni quand on se connecte au compte exemple par son mot de passe.
 * Chaque étape se coche toute seule quand l'écran correspondant est ouvert ; l'avancement reste sur l'appareil.
 */
const KEY = "mr-demo-tour";
type TourState = { on: boolean; open: boolean; seen: string[] };

const STEPS = [
  { key: "salle", title: "Le plan de salle", text: "Chaque table affiche son état : libre, commande en cours, plats à apporter.", href: "/pos", match: (p: string) => p === "/pos" },
  { key: "commande", title: "Prendre une commande", text: "Touchez une table libre, choisissez les couverts, ajoutez des plats puis « Envoyer ». « Payer » encaisse ensuite.", href: "/pos", match: (p: string) => p.startsWith("/pos/order/") },
  { key: "cuisine", title: "L'écran cuisine", text: "La commande arrive en cuisine en temps réel, poste par poste.", href: "/kds", match: (p: string) => p.startsWith("/kds") },
  { key: "chiffres", title: "Vos chiffres", text: "Le tableau de bord montre les ventes du jour pendant le service.", href: "/admin", match: (p: string) => p === "/admin" },
] as const;

function read(): TourState | null {
  try { const v = localStorage.getItem(KEY); return v ? (JSON.parse(v) as TourState) : null; } catch { return null; }
}
function write(s: TourState) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* stockage indisponible : la visite reste visible jusqu'au rechargement */ }
}

/** À l'entrée dans la démo : la visite repart de zéro, ouverte. */
export function startDemoTour() {
  write({ on: true, open: true, seen: [] });
}

export function DemoTour() {
  const { me } = useSession();
  const pathname = usePathname() ?? "";
  const [state, setState] = useState<TourState | null>(null);

  // Lecture au montage (le stockage n'existe pas côté serveur), puis étape cochée à l'ouverture de son écran
  useEffect(() => {
    const s = read();
    let next: TourState | null = null;
    if (s?.on) {
      const step = STEPS.find((x) => x.match(pathname));
      next = step && !s.seen.includes(step.key) ? { ...s, seen: [...s.seen, step.key] } : s;
      if (next !== s) write(next);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- état lu dans le stockage du navigateur
    setState(next);
  }, [pathname]);

  const inApp = pathname.startsWith("/pos") || pathname.startsWith("/admin") || pathname.startsWith("/kds");
  if (!state?.on || !me?.isDemo || !inApp || pathname.startsWith("/pos/appel")) return null;

  const update = (s: TourState) => { write(s); setState(s); };
  const done = STEPS.filter((s) => state.seen.includes(s.key)).length;
  const all = done === STEPS.length;
  const current = STEPS.find((s) => !state.seen.includes(s.key));

  // Téléphone : bandeau intégré en haut de l'écran (il pousse le contenu au lieu de le cacher), étape en cours seulement.
  // Ordinateur : panneau flottant en bas à gauche avec toutes les étapes.
  const box = "no-print relative z-30 mx-3 mt-2 shrink-0 bg-nuit-950/95 text-white shadow-lift ring-1 ring-white/15 sm:fixed sm:bottom-[92px] sm:left-5 sm:z-40 sm:mx-0 sm:mt-0 sm:backdrop-blur-xl";

  if (!state.open) {
    return (
      <button type="button" onClick={() => update({ ...state, open: true })} data-testid="demo-tour-pill"
        className={`${box} flex h-11 items-center gap-2 rounded-2xl px-4 text-left text-sm font-extrabold sm:inline-flex sm:rounded-full`}>
        <Compass className="h-4 w-4 shrink-0 text-[#5eead4]" /><span className="shrink-0">Visite guidée {done}/{STEPS.length}</span>
        {current ? <span className="min-w-0 truncate font-semibold text-white/70 sm:hidden">· {current.title}</span> : null}
      </button>
    );
  }

  return (
    <aside data-testid="demo-tour" aria-label="Visite guidée du restaurant exemple"
      className={`${box} rounded-2xl p-3 sm:max-h-[60vh] sm:w-[330px] sm:overflow-y-auto sm:rounded-3xl sm:p-4`}>
      <div className="flex items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#2dd4bf]/15 text-[#5eead4]">{all ? <PartyPopper className="h-5 w-5" /> : <Compass className="h-5 w-5" />}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-[#5eead4]">Visite guidée · {done}/{STEPS.length}</p>
          <p className="truncate text-sm font-extrabold">{all ? "Vous avez fait le tour !" : <><span className="sm:hidden">{current?.title}</span><span className="hidden sm:inline">L&apos;essentiel en deux minutes</span></>}</p>
        </div>
        <button type="button" onClick={() => update({ ...state, open: false })} className="touch grid h-9 w-9 place-items-center rounded-xl text-white/70 hover:bg-white/10" aria-label="Réduire la visite guidée" title="Réduire"><ChevronDown className="h-5 w-5" /></button>
        <button type="button" onClick={() => update({ ...state, on: false })} className="touch grid h-9 w-9 place-items-center rounded-xl text-white/70 hover:bg-white/10" aria-label="Fermer la visite guidée" title="Fermer" data-testid="demo-tour-close"><X className="h-5 w-5" /></button>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10 sm:mt-3"><div className="h-full rounded-full bg-gradient-to-r from-[#2dd4bf] to-corail-400 transition-all" style={{ width: `${(done / STEPS.length) * 100}%` }} /></div>
      {current ? (
        <div className="mt-2 flex items-start gap-2 sm:hidden">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-white/80">{current.text}</p>
          {pathname !== current.href ? <Link href={current.href} className="shrink-0 rounded-full bg-[#2dd4bf] px-3 py-1.5 text-xs font-extrabold text-[#042f2e]">Y aller</Link> : null}
        </div>
      ) : null}
      <ol className="mt-3 hidden space-y-1.5 sm:block">
        {STEPS.map((s, i) => {
          const ok = state.seen.includes(s.key), now = current?.key === s.key;
          return (
            <li key={s.key} className={`rounded-2xl p-2.5 ${now ? "bg-white/10 ring-1 ring-[#2dd4bf]/40" : ""}`}>
              <div className="flex items-center gap-2.5">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-extrabold ${ok ? "bg-[#2dd4bf] text-[#042f2e]" : "bg-white/15 text-white"}`}>{ok ? <Check className="h-3.5 w-3.5" /> : i + 1}</span>
                <span className={`text-sm font-bold ${ok && !now ? "text-white/60" : ""}`}>{s.title}</span>
                {now && pathname !== s.href ? <Link href={s.href} className="ml-auto rounded-full bg-[#2dd4bf] px-3 py-1 text-xs font-extrabold text-[#042f2e]">Y aller</Link> : null}
              </div>
              {now ? <p className="mt-1.5 pl-[34px] text-xs leading-relaxed text-white/75">{s.text}</p> : null}
            </li>
          );
        })}
      </ol>
      {all ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-white/10 p-3">
          <p className="min-w-0 flex-1 basis-48 text-xs text-white/80">Prêt à essayer avec votre propre carte ? 15 jours gratuits, sans carte bancaire.</p>
          <Link href="/signup" className="flex h-11 flex-1 basis-40 items-center justify-center rounded-xl bg-corail-500 px-4 text-sm font-extrabold text-white shadow-glow" data-testid="demo-tour-signup">Créer mon restaurant</Link>
        </div>
      ) : null}
    </aside>
  );
}
