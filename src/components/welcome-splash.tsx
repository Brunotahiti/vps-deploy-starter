"use client";

import { useEffect, useRef } from "react";
import { Logo } from "@/components/brand";

/**
 * Écran d'accueil animé après la connexion : vagues du lagon, logo qui surgit, salutation en tahitien.
 * Respecte « réduire les animations » (affichage bref, sans mouvement).
 */
export function WelcomeSplash({ name, onDone }: { name?: string | null; onDone: () => void }) {
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  useEffect(() => {
    const reduced = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = setTimeout(() => done.current(), reduced ? 500 : 1900);
    return () => clearTimeout(t);
  }, []);
  const hour = new Date().getHours();
  const wish = hour < 11 ? "Belle matinée de service !" : hour < 17 ? "Bon service !" : "Belle soirée de service !";
  const wave = "M0 60 C 150 20 300 100 450 60 C 600 20 750 100 900 60 C 1050 20 1200 100 1350 60 C 1500 20 1650 100 1800 60 V 200 H 0 Z";
  return (
    <div className="splash bg-lagoon fixed inset-0 z-[80] flex flex-col items-center justify-center overflow-hidden text-white" role="status" aria-live="polite" data-testid="welcome-splash">
      <span className="splash-float absolute -left-16 top-16 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
      <span className="splash-float absolute -right-10 bottom-40 h-72 w-72 rounded-full bg-corail-400/25 blur-3xl" style={{ animationDelay: "-2s" }} />
      <div className="relative flex h-40 w-40 items-center justify-center">
        <span className="splash-ripple absolute inset-4 rounded-full border-2 border-white/60" />
        <span className="splash-ripple splash-ripple-2 absolute inset-4 rounded-full border-2 border-white/40" />
        <span className="splash-logo flex h-28 w-28 items-center justify-center rounded-[32px] bg-white/15 shadow-lift ring-1 ring-white/30 backdrop-blur"><Logo size={72} light withText={false} /></span>
      </div>
      <h1 className="splash-text mt-6 text-center text-3xl font-extrabold tracking-tight sm:text-4xl">Ia ora na{name ? `, ${name}` : ""} !</h1>
      <p className="splash-text splash-sub mt-2 text-center text-base font-medium text-white/85">{wish}</p>
      <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full" viewBox="0 0 1800 200" preserveAspectRatio="none" aria-hidden="true">
        <g className="splash-wave"><path d={wave} fill="rgba(255,255,255,0.18)" /><path d={wave} fill="rgba(255,255,255,0.18)" transform="translate(1800 0)" /></g>
        <g className="splash-wave splash-wave-2"><path d={wave} fill="rgba(255,255,255,0.22)" transform="translate(0 30)" /><path d={wave} fill="rgba(255,255,255,0.22)" transform="translate(1800 30)" /></g>
      </svg>
    </div>
  );
}
