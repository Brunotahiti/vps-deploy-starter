import Link from "next/link";
import { PhaseNotice } from "@/components/ui/misc";
import { Logo } from "@/components/brand";

export default function KdsPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between"><Logo /><Link href="/pos" className="text-sm font-semibold text-lagon-600">← Retour à la caisse</Link></div>
      <PhaseNotice phase={3} feature="Écran cuisine (KDS) : CUISINE, BAR, PIZZA, DESSERTS, GRILL, PASSE" />
      <div className="mt-4 rounded-2xl border border-line surface p-4 text-sm text-muted">
        <p className="mb-2 font-semibold text-[var(--text)]">Ce qui existe déjà (Phase 2) :</p>
        <ul className="list-inside list-disc space-y-1">
          <li>chaque envoi depuis la caisse crée des tickets cuisine (table kitchen_tickets) routés par poste selon le produit ;</li>
          <li>les statuts « à suivre », « faire marcher », « urgent », « ne pas envoyer » sont gérés côté commande ;</li>
          <li>les événements temps réel <code>kitchen.updated</code> sont déjà publiés.</li>
        </ul>
        <p className="mt-2">La Phase 3 ajoutera l&apos;affichage des tickets, les actions ACCEPTER / EN PRÉPARATION / PRÊT / TERMINÉ et les alertes de temps.</p>
      </div>
    </main>
  );
}
