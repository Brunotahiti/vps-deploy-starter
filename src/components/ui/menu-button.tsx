"use client";

import { Menu } from "lucide-react";

/**
 * Bouton « Menu » du téléphone, dessiné comme les boutons de la barre des portails (Salle, Commande, Caisse…) :
 * tuile en dégradé, icône et libellé. `blink` : clignote trois fois à son apparition, pour qu'on le repère.
 */
export function MenuButton({ onClick, blink = false, className = "" }: { onClick: () => void; blink?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label="Ouvrir le menu" data-testid="menu-button" data-blink={blink || undefined}
      className={`touch flex h-14 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl bg-gradient-to-br from-lagon-400 to-lagon-600 text-white shadow-[0_10px_30px_-10px_rgb(20_170_163/0.8)] transition active:scale-[0.97] ${blink ? "menu-blink" : ""} ${className}`}>
      <Menu className="h-5 w-5" />
      <span className="text-[11px] font-extrabold leading-none" aria-hidden>Menu</span>
    </button>
  );
}
