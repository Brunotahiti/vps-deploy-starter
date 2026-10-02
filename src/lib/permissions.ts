/**
 * Permissions granulaires ManaResto.
 * Les clés sont stockées en base (table permissions) et attachées aux rôles.
 */
export const PERMISSIONS = {
  // POS
  "pos.use": { group: "Caisse", description: "Utiliser la caisse" },
  "pos.discount": { group: "Caisse", description: "Appliquer une remise" },
  "pos.void_item": { group: "Caisse", description: "Supprimer un article déjà envoyé" },
  "pos.cancel_order": { group: "Caisse", description: "Annuler une commande" },
  "pos.refund": { group: "Caisse", description: "Rembourser un paiement" },
  "pos.open_drawer": { group: "Caisse", description: "Ouvrir le tiroir-caisse sans vente" },
  "pos.price_override": { group: "Caisse", description: "Modifier un prix en caisse" },
  "pos.transfer_table": { group: "Caisse", description: "Transférer une table" },
  // Caisse (espèces)
  "cash.open": { group: "Espèces", description: "Ouvrir une session de caisse" },
  "cash.close": { group: "Espèces", description: "Clôturer une session de caisse" },
  "cash.movement": { group: "Espèces", description: "Enregistrer une entrée/sortie d'espèces" },
  "cash.correct": { group: "Espèces", description: "Corriger une clôture" },
  // Catalogue
  "catalog.view": { group: "Catalogue", description: "Consulter le catalogue" },
  "catalog.manage": { group: "Catalogue", description: "Gérer produits, catégories, options, TVA" },
  "catalog.availability": { group: "Catalogue", description: "Marquer un produit indisponible" },
  // Salle
  "floor.manage": { group: "Salle", description: "Gérer salles et tables" },
  // Cuisine
  "kds.use": { group: "Cuisine", description: "Utiliser l'écran cuisine" },
  // Gestion
  "users.manage": { group: "Gestion", description: "Gérer utilisateurs et rôles" },
  "settings.manage": { group: "Gestion", description: "Gérer les paramètres de l'établissement" },
  "establishments.manage": { group: "Gestion", description: "Créer/modifier des établissements" },
  "reports.view": { group: "Rapports", description: "Consulter les rapports de l'établissement" },
  "reports.view_global": { group: "Rapports", description: "Consulter le CA global multi-établissements" },
  "audit.view": { group: "Rapports", description: "Consulter le journal d'audit" },
  "orders.view_history": { group: "Rapports", description: "Consulter l'historique des commandes" },
  // Stock
  "stock.view": { group: "Stock", description: "Consulter les stocks" },
  "stock.manage": { group: "Stock", description: "Gérer stocks, inventaires, fournisseurs" },
  // Clients
  "customers.manage": { group: "Clients", description: "Gérer clients, fidélité, réservations" },
  // Personnel
  "staff.manage": { group: "Personnel", description: "Gérer personnel et pointages" },
  // Hygiène (option)
  "hygiene.record": { group: "Hygiène", description: "Enregistrer relevés de température, nettoyages et traçabilité" },
  "hygiene.manage": { group: "Hygiène", description: "Gérer le plan d'hygiène (équipements, nettoyage) et consulter le registre" },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

/** Session « caisse » (ouverte par un boîtier de secours) : jamais plus que ces droits, même pour le propriétaire. */
export const POS_SCOPE_PERMISSIONS: PermissionKey[] = [
  "pos.use", "pos.discount", "pos.void_item", "pos.cancel_order", "pos.refund", "pos.open_drawer", "pos.price_override", "pos.transfer_table",
  "cash.open", "cash.close", "cash.movement", "catalog.view", "catalog.availability", "kds.use", "customers.manage", "orders.view_history",
];

export const SYSTEM_ROLES: Record<string, { name: string; permissions: PermissionKey[] | "*" }> = {
  owner: { name: "Admin (propriétaire)", permissions: "*" },
  // Les quatre profils principaux (voir src/lib/profiles.ts) puis les profils spécialisés
  admin: { name: "Admin", permissions: "*" },
  manager: {
    name: "Gérant",
    permissions: ALL_PERMISSIONS.filter((p) => !["establishments.manage", "reports.view_global"].includes(p)),
  },
  kitchen: {
    name: "Chef en cuisine",
    permissions: ["kds.use", "catalog.view", "catalog.manage", "catalog.availability", "stock.view", "stock.manage", "orders.view_history", "hygiene.record", "hygiene.manage"],
  },
  server: {
    name: "Équipe en salle",
    permissions: ["pos.use", "pos.transfer_table", "catalog.view", "catalog.availability", "customers.manage", "hygiene.record"],
  },
  cashier: {
    name: "Responsable caisse",
    permissions: [
      "pos.use", "pos.discount", "pos.void_item", "pos.cancel_order", "pos.refund", "pos.open_drawer", "pos.transfer_table",
      "cash.open", "cash.close", "cash.movement",
      "catalog.view", "catalog.availability", "orders.view_history", "reports.view", "customers.manage",
    ],
  },
  bartender: {
    name: "Barman",
    permissions: ["pos.use", "kds.use", "catalog.view", "catalog.availability", "cash.open", "cash.close", "cash.movement"],
  },
  accountant: {
    name: "Comptable",
    permissions: ["reports.view", "reports.view_global", "audit.view", "orders.view_history", "stock.view"],
  },
};

export function hasPermission(perms: ReadonlySet<string> | string[], key: PermissionKey): boolean {
  const set = perms instanceof Set ? perms : new Set(perms);
  return set.has("*") || set.has(key);
}
