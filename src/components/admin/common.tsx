"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";

export function useList<T>(key: string[], url: string, enabled = true) {
  return useQuery({ queryKey: key, queryFn: () => api.get<T>(url), enabled });
}

/** Exécute une mutation, affiche le résultat, invalide les clés. */
export function useAction() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return async <T,>(fn: () => Promise<T>, opts: { success?: string; invalidate?: string[][] } = {}): Promise<T | null> => {
    try {
      const r = await fn();
      if (opts.success) toast(opts.success, "success");
      for (const k of opts.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
      return r;
    } catch (e) {
      toast(e instanceof ApiClientError ? (e.details && Array.isArray(e.details) ? `${e.message} : ${(e.details as { path: unknown[]; message: string }[]).map((d) => `${d.path.join(".")} ${d.message}`).join(", ")}` : e.message) : "Erreur", "error");
      return null;
    }
  };
}

/** Aide sur place : chaque page de la gestion expliquée en une phrase (bouton « ? » à côté du titre). */
const HELP: [string, string][] = [
  ["/admin/catering", "Vos buffets, mariages, privatisations et repas d'entreprise : composez le devis avec les plats de votre carte, envoyez-le (le client l'accepte en ligne), encaissez l'acompte, puis facturez. La cuisine voit le planning et la fiche cuisine, sans les prix."],
  ["/admin/screens", "Chaque écran (télévision, tablette) affiche votre carte à une adresse secrète, sans connexion d'un employé. Prix et plats épuisés se mettent à jour tout seuls ; la mise en avant sert pour le plat du jour."],
  ["/admin/marketing", "Cartes cadeaux à vendre et à utiliser à la caisse, campagnes par e-mail aux clients qui l'ont accepté (anniversaires, clients à faire revenir), et lien d'avis Google sur vos reçus et vos tables."],
  ["/admin/hygiene", "Votre plan d'hygiène sans papier : relevés de température matin et soir, nettoyages à cocher, réceptions et préparations avec leur date limite. Le registre imprimable est prêt pour un contrôle sanitaire."],
  ["/admin/accounts", "Les clients à qui vous faites crédit (entreprises, administrations, habitués) : à la caisse, « Sur compte » met l'addition sur leur compte ; ici vous facturez, enregistrez leurs règlements et relancez les retards."],
  ["/admin/orders", "Toutes les commandes, en cours et passées. Ouvrez-en une pour voir son détail, réimprimer le ticket ou la rembourser."],
  ["/admin/cash", "Les sessions de caisse : ouverture, entrées et sorties d'espèces, clôture et écart. Le rapport Z s'imprime d'ici."],
  ["/admin/stats", "Vos ventes en graphiques : par jour, par heure, par produit et par serveur."],
  ["/admin/reports", "Les chiffres de la période choisie et leurs exports (tableur, comptabilité)."],
  ["/admin/catalog", "Votre carte : catégories, produits, prix, options (cuisson, suppléments) et formules. Ce qui est ici s'affiche à la caisse."],
  ["/admin/stock", "Le stock des ingrédients baisse à chaque vente selon les recettes. Inventaires, fournisseurs et commandes d'achat."],
  ["/admin/floor", "Dessinez vos salles et placez vos tables : c'est le plan que l'équipe voit à la caisse."],
  ["/admin/ai", "Prévisions de fréquentation (vert, orange, rouge, noir), analyse qualité inspirée de l'ISO 9001 et commande d'achats proposée. Les chiffres viennent de vos ventes et réservations."],
  ["/admin/customers", "Vos clients, leurs visites et leurs points de fidélité."],
  ["/admin/digital", "QR codes à table, commande en ligne et borne : vos clients commandent eux-mêmes, les commandes arrivent en caisse et en cuisine."],
  ["/admin/staff", "Le personnel, les plannings et les heures pointées, avec le coût de la main d'œuvre."],
  ["/admin/users", "Un compte par personne, avec un PIN de 4 chiffres pour se connecter vite à la caisse. Le profil fixe ce que chacun peut faire."],
  ["/admin/settings", "Les informations de l'établissement (imprimées sur les tickets), les horaires, les services du repas et les moyens de paiement."],
  ["/admin/hardware", "Branchez vos imprimantes de tickets et de cuisine et le tiroir-caisse ; le bouton « Tester » vérifie que tout fonctionne."],
  ["/admin/integrations", "Clés d'API et webhooks pour relier ManaResto à d'autres logiciels."],
  ["/admin/establishments", "Vos établissements : ajoutez-en un, copiez la carte de l'un vers l'autre."],
  ["/admin/organization", "Le chiffre d'affaires de tous vos établissements, côte à côte."],
  ["/admin/audit", "Qui a fait quoi, et quand : remises, annulations, ouvertures du tiroir, changements de réglages."],
  ["/admin/options", "Le programme de base suffit pour démarrer. Débloquez une option quand vous en avez besoin : l'équipe ManaResto l'active pour vous."],
  ["/admin", "Le résumé de la journée : chiffre d'affaires, commandes en cours et comparaison avec la semaine dernière."],
];

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const help = HELP.find(([p]) => (p === "/admin" ? pathname === "/admin" : pathname.startsWith(p)))?.[1];
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-[26px] font-extrabold tracking-tight">{title}
            {help ? <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Aide sur cette page" title="À quoi sert cette page ?" className={`touch flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold transition ${open ? "bg-lagon-600 text-white" : "surface-2 text-lagon-700 hover:bg-lagon-500/15 dark:text-lagon-300"}`}>?</button> : null}
          </h1>
          {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {help && open ? <p className="mt-3 max-w-3xl rounded-xl bg-lagon-500/10 px-4 py-3 text-sm text-lagon-900 dark:text-lagon-100" data-testid="page-help">{help}</p> : null}
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-muted">{head.map((h, i) => <th key={i} className="px-4 py-3 font-bold">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const Tr = ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => <tr onClick={onClick} className={`border-b border-line last:border-0 ${onClick ? "cursor-pointer hover:surface-2" : ""}`}>{children}</tr>;
export const Td = ({ children, className = "", title }: { children?: React.ReactNode; className?: string; title?: string }) => <td title={title} className={`px-4 py-2.5 align-middle ${className}`}>{children}</td>;

export function Tabs({ tabs }: { tabs: { href: string; label: string; active: boolean }[] }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map((t) => <a key={t.href} href={t.href} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${t.active ? "border-lagon-500 text-lagon-600" : "border-transparent text-muted hover:text-[var(--text)]"}`}>{t.label}</a>)}
    </div>
  );
}
