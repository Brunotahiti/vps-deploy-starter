"use client";

import { Menu } from "lucide-react";

/**
 * Bouton « Menu » du téléphone, dessiné comme les boutons de la barre des portails (Salle, Commande, Caisse…) :
 * tuile en dégradé, icône et libellé. `blink` : clignote trois fois à son apparition, pour qu'on le repère.
 * Ombre courte et nette : un grand halo diffus se fondrait dans l'en-tête translucide (effet « flou »).
 */
export function MenuButton({ onClick, blink = false, className = "" }: { onClick: () => void; blink?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label="Ouvrir le menu" data-testid="menu-button" data-blink={blink || undefined}
      className={`touch flex h-14 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl bg-gradient-to-br from-lagon-500 to-lagon-700 text-white shadow-[0_4px_10px_-3px_rgb(15_110_108/0.55)] ring-1 ring-black/5 transition active:scale-[0.97] ${blink ? "menu-blink" : ""} ${className}`}>
      <Menu className="h-5 w-5" />
      <span className="text-[11px] font-extrabold leading-none" aria-hidden>Menu</span>
    </button>
  );
}
