"use client";

import { useSyncExternalStore } from "react";
import { Hand, MousePointerClick, Palette, X } from "lucide-react";

const KEY = "mr-floor-guide-hidden";
const listeners = new Set<() => void>();
const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

/**
 * « Comment ça marche » du plan de salle, en trois étapes : dessiner la salle, ouvrir une table à la caisse,
 * suivre le service d'un coup d'œil. Masquable (souvenir sur l'appareil), réaffichable par le lien « Comment ça marche ».
 */
export function FloorGuide() {
  const hidden = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, read, () => false);
  const set = (v: boolean) => { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* stockage indisponible */ } listeners.forEach((cb) => cb()); };
  if (hidden) return <button onClick={() => set(false)} className="mb-3 self-start text-sm font-semibold text-lagon-600 hover:underline" data-testid="floor-guide-show">Comment ça marche ?</button>;
  const steps = [
    { icon: Hand, title: "1. Dessinez votre salle", text: "Ajoutez vos salles (salle, terrasse, bar) puis vos tables avec « + Table ». Glissez-les du doigt à leur vraie place. Touchez une table pour choisir son nom, sa forme (ronde, carrée, rectangle), ses places et sa rotation : les chaises se dessinent toutes seules. Enregistrez." },
    { icon: MousePointerClick, title: "2. Servez depuis la caisse", text: "À la caisse, l'équipe voit ce même plan. Une table libre : on la touche, on choisit le nombre de couverts, la commande s'ouvre. Une table occupée : on la touche pour reprendre sa commande, ajouter des plats ou encaisser." },
    { icon: Palette, title: "3. Suivez le service d'un coup d'œil", text: "La couleur dit l'état de chaque table (libre, en commande, servie, addition demandée, réservée). Sur la table : le montant, le temps passé, les couverts, l'étape du repas (entrées, plats, desserts) et le serveur. Un retard de service fait clignoter la table en rouge." },
  ];
  return (
    <section className="card relative mb-3 p-4" data-testid="floor-guide">
      <button onClick={() => set(true)} className="touch absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full text-muted hover:surface-2" aria-label="Masquer l'explication"><X className="h-4 w-4" /></button>
      <p className="mb-3 pr-10 text-base font-extrabold">Comment ça marche ?</p>
      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.title} className="flex gap-3 rounded-2xl surface-2 p-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-lagon-400 to-lagon-600 text-white"><s.icon className="h-5 w-5" /></span>
            <div className="min-w-0"><p className="text-sm font-extrabold">{s.title}</p><p className="mt-0.5 text-sm leading-snug text-muted">{s.text}</p></div>
          </li>
        ))}
      </ol>
    </section>
  );
}
