"use client";

import Link from "next/link";
import { useSession } from "@/hooks/use-session";
import { PORTALS, rememberPortal, type PortalMode } from "./portals";

/**
 * Accès aux portails Salle, Caisse et Cuisine depuis les menus. L'utilisateur étant déjà connecté, le bouton
 * ouvre directement l'écran de l'équipe et mémorise le portail de l'appareil pour le prochain changement d'utilisateur.
 * « tiles » : trois tuiles dans un menu latéral ; « dock » : barre fixe en bas d'écran sur téléphone.
 */
export function PortalButtons({ variant = "tiles", onNavigate }: { variant?: "tiles" | "dock"; onNavigate?: () => void }) {
  const { can } = useSession();
  const modes = (Object.keys(PORTALS) as PortalMode[]).filter((m) => can(PORTALS[m].permission));
  if (!modes.length) return null;

  if (variant === "dock") {
    return (
      <nav aria-label="Portails" className="pointer-events-auto flex w-full max-w-md gap-2 rounded-[22px] bg-nuit-950/85 p-1.5 shadow-[0_16px_40px_-12px_rgb(6_10_23/0.6)] ring-1 ring-white/10 backdrop-blur-xl">
        {modes.map((m) => {
          const p = PORTALS[m];
          return (
            <Link key={m} href={p.next} onClick={() => { rememberPortal(m); onNavigate?.(); }} className={`touch flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl bg-gradient-to-br text-white transition active:scale-[0.97] ${p.tile}`}>
              <p.icon className="h-5 w-5" /><span className="text-xs font-extrabold tracking-wide">{p.label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <div>
      <p className="mb-1.5 px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Portails</p>
      <nav aria-label="Portails" className={`grid gap-2 ${modes.length === 3 ? "grid-cols-3" : modes.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
        {modes.map((m) => {
          const p = PORTALS[m];
          return (
            <Link key={m} href={p.next} onClick={() => { rememberPortal(m); onNavigate?.(); }} title={p.title} className={`group relative flex h-[72px] flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl bg-gradient-to-br text-white transition hover:-translate-y-0.5 active:scale-[0.97] ${p.tile}`}>
              <span aria-hidden className="absolute -right-4 -top-4 h-12 w-12 rounded-full bg-white/20 blur-md transition group-hover:scale-125" />
              <p.icon className="relative h-6 w-6 drop-shadow" /><span className="relative text-xs font-extrabold tracking-wide">{p.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
