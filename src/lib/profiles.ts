/**
 * Les quatre profils de l'équipe, présentés simplement : ce que chacun voit et peut faire.
 * Les droits eux-mêmes sont ceux des rôles système (src/lib/permissions.ts, SYSTEM_ROLES).
 */
export type ProfileKey = "admin" | "manager" | "kitchen" | "server";

export type Profile = {
  key: ProfileKey;
  name: string;
  emoji: string;
  /** Couleur de la carte (dégradé Tailwind) */
  tile: string;
  tagline: string;
  /** Écran ouvert à la connexion */
  home: string;
  can: string[];
  cannot: string[];
};

export const PROFILES: Profile[] = [
  {
    key: "admin", name: "Admin", emoji: "👑", tile: "from-violet-500 to-indigo-600",
    tagline: "Tous les droits, sur tous les établissements",
    home: "/admin",
    can: ["Tout ce que fait le gérant", "Créer et gérer les établissements", "Chiffre d'affaires de tous les établissements", "Nommer d'autres admins"],
    cannot: ["Modifier le compte du propriétaire"],
  },
  {
    key: "manager", name: "Gérant", emoji: "🧭", tile: "from-sky-500 to-blue-600",
    tagline: "Fait tourner le restaurant au quotidien",
    home: "/admin",
    can: ["Équipe, plannings et PIN", "Carte, prix et TVA", "Caisse : remises, annulations, remboursements, clôture", "Stocks et commandes fournisseurs", "Statistiques et rapports"],
    cannot: ["Créer un établissement", "Nommer un admin"],
  },
  {
    key: "kitchen", name: "Chef en cuisine", emoji: "👨‍🍳", tile: "from-orange-500 to-rose-500",
    tagline: "La cuisine, la carte et les stocks",
    home: "/kds",
    can: ["Écran cuisine : préparer, envoyer, confirmer les modifications", "Carte et recettes", "Marquer un plat en rupture", "Stocks, inventaires et commandes fournisseurs"],
    cannot: ["Encaisser ou ouvrir la caisse", "Voir le chiffre d'affaires", "Gérer l'équipe"],
  },
  {
    key: "server", name: "Équipe en salle", emoji: "🙋", tile: "from-emerald-500 to-teal-600",
    tagline: "Accueille, prend les commandes et encaisse",
    home: "/pos",
    can: ["Plan de salle et prise de commande (aussi au téléphone)", "Envoyer en cuisine, demander une modification", "Encaisser l'addition", "Réservations et fiches clients", "Marquer un plat en rupture"],
    cannot: ["Remise, annulation ou remboursement sans le PIN d'un gérant", "Voir les rapports", "Modifier la carte"],
  },
];

export const PROFILE_BY_KEY: Record<string, Profile> = Object.fromEntries(PROFILES.map((p) => [p.key, p]));

/** Écran d'accueil après la connexion selon le profil (propriétaire : comme un admin). */
export function profileHome(roleKey: string | null | undefined, isOwner: boolean): string | null {
  if (isOwner) return "/admin";
  return roleKey ? PROFILE_BY_KEY[roleKey]?.home ?? null : null;
}
