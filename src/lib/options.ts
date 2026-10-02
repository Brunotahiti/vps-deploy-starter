import type { PermissionKey } from "./permissions";

/**
 * Programme de base (caisse, salle, cuisine, encaissement, tickets, rapports simples) + options payantes.
 * Une option désactivée masque ses écrans et retire ses droits à tout le monde, propriétaire compris
 * (le serveur refuse aussi ses routes) ; elle se débloque depuis Gestion → Options.
 */
export const OPTIONS = {
  stock: {
    label: "Stock et recettes",
    tagline: "Savoir ce qu'il reste et ce que coûte chaque plat",
    includes: ["Ingrédients et recettes : le stock baisse à chaque vente", "Inventaires et alertes de stock bas", "Fournisseurs et bons de commande", "Coût matière de chaque plat"],
    permissions: ["stock.view", "stock.manage"],
  },
  digital: {
    label: "Digital",
    tagline: "Vos clients commandent et réservent seuls",
    includes: ["QR code à table : menu et commande depuis le téléphone", "Commande en ligne à emporter ou en livraison, 0 % de commission", "Borne de commande", "Site du restaurant, réservation en ligne et fidélité", "Réservations avancées : planning des tables, client reconnu au téléphone, confirmation par e-mail"],
    permissions: ["customers.manage"],
  },
  team: {
    label: "Équipe",
    tagline: "Plannings, pointage et coût du personnel",
    includes: ["Fiches du personnel et plannings", "Pointage des arrivées et départs", "Heures travaillées et coût de la main d'œuvre"],
    permissions: ["staff.manage"],
  },
  stats: {
    label: "Statistiques & rapports",
    tagline: "Comprendre vos ventes et exporter vos chiffres",
    includes: ["Statistiques : ventes par jour, par heure, par produit et par serveur", "Rapports sur la période de votre choix", "Exports tableur et exports comptables"],
    permissions: [],
  },
  continuity: {
    label: "Continuité de service",
    tagline: "La caisse continue quand internet coupe",
    includes: ["Mode hors ligne des tablettes : commandes, encaissements et tickets sans internet", "Connexion des employés par PIN sans internet", "Boîtier de secours sur place pour les longues coupures", "Tout se resynchronise au retour du réseau"],
    permissions: [],
  },
  advanced: {
    label: "Avancé",
    tagline: "Pour les établissements qui grandissent",
    includes: ["Plusieurs établissements et chiffre d'affaires global", "Journal d'audit et rôles sur mesure", "API et intégrations (webhooks)"],
    permissions: ["establishments.manage", "reports.view_global", "audit.view"],
  },
} as const satisfies Record<string, { label: string; tagline: string; includes: readonly string[]; permissions: readonly PermissionKey[] }>;

export type OptionKey = keyof typeof OPTIONS;
export const OPTION_KEYS = Object.keys(OPTIONS) as OptionKey[];
export const isOptionKey = (k: string): k is OptionKey => k in OPTIONS;

/** Droits retirés quand des options ne sont pas débloquées */
export function lockedPermissions(enabled: readonly string[]): Set<string> {
  const locked = new Set<string>();
  for (const k of OPTION_KEYS) if (!enabled.includes(k)) for (const p of OPTIONS[k].permissions) locked.add(p);
  return locked;
}

/** Type d'activité : adapte l'écran (portail « Comptoir » pour un snack) et les réglages conseillés */
export const BUSINESS_TYPES = {
  snack: { label: "Snack, roulotte, comptoir", hint: "Ventes au comptoir et à emporter, sans service à table" },
  restaurant: { label: "Restaurant", hint: "Service à table : plan de salle, entrées, plats, desserts" },
  bar: { label: "Bar", hint: "Boissons et petite restauration, au comptoir ou en terrasse" },
} as const;
export type BusinessType = keyof typeof BUSINESS_TYPES;
export const isBusinessType = (k: string): k is BusinessType => k in BUSINESS_TYPES;

/**
 * Réglages conseillés à la création selon le type d'activité : un snack ou un bar n'a pas besoin des rappels
 * de service à table (« À faire maintenant »), réactivables à tout moment dans les Paramètres.
 */
export function businessTypeSettings(type: BusinessType): Record<string, unknown> {
  return type === "restaurant" ? {} : { service: { enabled: false } };
}
