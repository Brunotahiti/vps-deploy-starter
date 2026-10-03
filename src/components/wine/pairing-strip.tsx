"use client";

import { useQuery } from "@tanstack/react-query";
import { Wine } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Money } from "@/components/money";
import { WINE_COLOR_DOT, WINE_SERVING_LABEL, clLabel } from "@/lib/wine";
import type { Pairings } from "./types";

/**
 * Accords mets-vins à la caisse (option Cave à vin) : selon les plats de la commande, les vins conseillés
 * et leurs formats en vente, ajoutés d'un geste. Rien ne s'affiche sans accord ou sans l'option.
 */
export function WinePairingStrip({ productIds, onAdd }: { productIds: string[]; onAdd: (productId: string) => void }) {
  const { can, hasOption } = useSession();
  const allowed = hasOption("wine") && (can("wine.use") || can("wine.manage"));
  const q = useQuery({ queryKey: ["wine", "pairings"], queryFn: () => api.get<Pairings>("/api/wine/pairings"), enabled: allowed, staleTime: 60_000 });
  if (!allowed || !q.data) return null;
  const seen = new Set<string>();
  const wines = productIds.flatMap((id) => q.data[id] ?? []).filter((w) => (seen.has(w.wineId) ? false : (seen.add(w.wineId), true))).slice(0, 4);
  // Déjà un vin conseillé dans la commande : on ne le repropose pas
  const inOrder = new Set(productIds);
  const shown = wines.filter((w) => !w.formats.some((f) => inOrder.has(f.productId)));
  if (!shown.length) return null;
  return (
    <div className="border-t border-line px-4 py-3" data-testid="wine-pairings">
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-rose-800 dark:text-rose-300"><Wine className="h-3.5 w-3.5" />Accords mets-vins</p>
      <ul className="space-y-2">
        {shown.map((w) => (
          <li key={w.wineId}>
            <p className="flex items-center gap-1.5 text-xs font-semibold"><span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: WINE_COLOR_DOT[w.color] }} /><span className="truncate">{w.label}</span></p>
            <div className="mt-1 flex flex-wrap gap-1">
              {w.formats.filter((f) => f.available).map((f) => (
                <button key={f.productId} type="button" onClick={() => onAdd(f.productId)} className="touch h-8 rounded-lg bg-rose-500/10 px-2.5 text-[11px] font-bold text-rose-900 transition hover:bg-rose-500/20 dark:text-rose-100" aria-label={`Ajouter ${w.label}, ${WINE_SERVING_LABEL[f.serving].toLowerCase()}`}>
                  {f.serving === "BOTTLE" ? "Bouteille" : `${WINE_SERVING_LABEL[f.serving]} ${clLabel(f.ml)}`} · <Money amount={f.priceTtc} />
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
