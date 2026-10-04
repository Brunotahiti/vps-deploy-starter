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
    includes: ["QR code à table : menu et commande depuis le téléphone", "Commande en ligne à emporter ou en livraison, 0 % de commission", "Borne de commande", "Site du restaurant à une belle adresse à partager (manaresto.com/votre-restaurant), avec aperçu sur WhatsApp et Facebook", "Réservation en ligne et fidélité", "Réservations avancées : planning des tables, client reconnu au téléphone, confirmation par e-mail"],
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
  ai: {
    label: "Assistant IA",
    tagline: "Prévoir la demande et améliorer le restaurant",
    includes: ["Prévisions de fréquentation à 14 jours, façon Bison Futé (vert, orange, rouge, noir)", "Conseils de la semaine : équipe, mise en place, jours calmes à remplir", "Analyse qualité du restaurant inspirée de la norme ISO 9001, avec un plan d'actions", "Commande d'achats proposée selon votre consommation et les prévisions"],
    permissions: [],
  },
  hygiene: {
    label: "Hygiène & HACCP",
    tagline: "Votre plan de maîtrise sanitaire, sans papier",
    includes: ["Relevés de température des frigos et congélateurs, avec alerte hors limites", "Plan de nettoyage à cocher par l'équipe", "Traçabilité : réceptions, lots, préparations et dates limites (DLC)", "Étiquettes de préparation et registre prêt pour un contrôle sanitaire"],
    permissions: ["hygiene.record", "hygiene.manage"],
  },
  accounts: {
    label: "Comptes clients & factures pro",
    tagline: "Faire crédit aux entreprises et aux habitués, en toute clarté",
    includes: ["Ardoise par client pro, avec plafond d'encours", "Encaissement « Sur compte » depuis la caisse", "Facture en PDF avec le N° Tahiti du client, numérotation continue", "Règlements, factures en retard et relances par e-mail"],
    permissions: ["accounts.charge", "accounts.manage"],
  },
  marketing: {
    label: "Marketing & cartes cadeaux",
    tagline: "Faire revenir vos clients et en attirer de nouveaux",
    includes: ["Cartes cadeaux et bons d'achat : vente à la caisse, utilisation en une ou plusieurs fois", "Campagnes par e-mail : anniversaires du mois, clients qui ne reviennent plus, nouveautés", "Seulement aux clients qui l'ont accepté, avec un lien de désabonnement", "Avis Google : lien sur les reçus et affiche avec QR code pour les tables"],
    permissions: ["giftcards.sell", "marketing.manage"],
  },
  screens: {
    label: "Écrans en salle",
    tagline: "Votre carte sur une télévision, toujours à jour",
    includes: ["Menu affiché sur une télévision ou une tablette, sans connexion d'un employé", "Mis à jour tout seul : prix, plats épuisés, nouveautés", "Plat du jour ou happy hour mis en avant, catégories au choix, défilement automatique", "Plusieurs écrans : comptoir, terrasse, vitrine"],
    permissions: [],
  },
  catering: {
    label: "Traiteur & événements",
    tagline: "Devis, acomptes et factures pour vos buffets, mariages et privatisations",
    includes: ["Devis en PDF pour buffets, mariages, privatisations et repas d'entreprise", "Devis accepté en ligne par le client, acompte à la commande", "Facture finale, acomptes déduits", "Planning des événements, fiche cuisine, réservations en ligne fermées pendant une privatisation"],
    permissions: ["catering.view", "catering.manage"],
  },
  bar: {
    label: "Bar",
    tagline: "Ardoises, happy hour et cave à boissons",
    includes: ["Ardoises au comptoir : une note au nom du client, réglée en fin de soirée", "Happy hour automatique sur les créneaux et les boissons de votre choix", "Fiches cocktails pour le barman : doses, verre, garniture, préparation", "Cave du bar : bouteilles au cl, réceptions, inventaire, casse et alertes", "Verres offerts tracés avec leur motif et rapport du bar"],
    permissions: ["bar.use", "bar.manage"],
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

/**
 * Services ponctuels (facturés une fois) : demandés depuis Gestion → Options, réalisés par l'équipe ManaResto.
 * Ils réutilisent les demandes et les prix des options sous la clé « service:<clé> » (prix unique, pas mensuel).
 */
export const SERVICES = {
  menu_setup: {
    label: "Saisie de votre carte",
    tagline: "Nous saisissons votre carte pour vous",
    includes: ["Plats, prix, catégories et taux de TVA", "Options et suppléments (cuissons, sauces, formules)", "Photos fournies par vous mises en place", "Vous relisez, nous corrigeons"],
  },
  onsite_setup: {
    label: "Mise en place",
    tagline: "Tout est prêt avant votre premier service",
    includes: ["Installation des tablettes, imprimantes et tiroir-caisse", "Plan de salle, profils de l'équipe et codes PIN", "Réglage des tickets et de l'écran cuisine", "Un service d'essai complet ensemble"],
  },
  training: {
    label: "Formation de l'équipe",
    tagline: "Votre équipe à l'aise dès le premier jour",
    includes: ["Prise de commande, envoi en cuisine, encaissement", "Ouverture et clôture de caisse", "Réservations et vente à emporter", "Réponses à vos questions, au rythme de votre équipe"],
  },
  hardware_pack: {
    label: "Pack matériel",
    tagline: "Le matériel adapté, configuré et testé",
    includes: ["Choisi avec vous selon votre activité (tablette, imprimante tickets, tiroir-caisse)", "Configuré et relié à ManaResto avant la livraison", "Testé avec votre carte"],
  },
} as const satisfies Record<string, { label: string; tagline: string; includes: readonly string[] }>;
export type ServiceKey = keyof typeof SERVICES;
export const SERVICE_KEYS = Object.keys(SERVICES) as ServiceKey[];
export const isServiceKey = (k: string): k is ServiceKey => k in SERVICES;
/** Clé de demande / de prix d'un service ponctuel */
export const serviceRef = (k: ServiceKey) => `service:${k}`;
export const serviceOf = (ref: string): ServiceKey | null => (ref.startsWith("service:") && isServiceKey(ref.slice(8)) ? (ref.slice(8) as ServiceKey) : null);
