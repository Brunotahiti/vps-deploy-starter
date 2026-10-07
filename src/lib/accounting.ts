/**
 * Comptabilité : catégories de dépenses et comptes de charges associés (plan comptable général, usage Polynésie).
 * Partagé entre l'écran Comptabilité, le service et les exports.
 */
export const EXPENSE_CATEGORIES = {
  FOOD: { label: "Achats alimentaires", account: "601000", hint: "Factures de nourriture hors bons de commande" },
  DRINKS: { label: "Achats boissons", account: "607000", hint: "Boissons revendues en l'état" },
  SUPPLIES: { label: "Fournitures, emballages, petit matériel", account: "606000", hint: "Barquettes, serviettes, produits d'entretien, vaisselle" },
  RENT: { label: "Loyer et charges locatives", account: "613000", hint: "Loyer, emplacement, charges" },
  ENERGY: { label: "Électricité, eau, gaz", account: "606100", hint: "EDT, Polynésienne des eaux, bouteilles de gaz" },
  MAINTENANCE: { label: "Entretien et réparations", account: "615000", hint: "Réparations, maintenance du matériel" },
  INSURANCE: { label: "Assurances", account: "616000", hint: "Multirisque, véhicule" },
  FEES: { label: "Honoraires", account: "622000", hint: "Comptable, avocat, conseils" },
  MARKETING: { label: "Publicité et marketing", account: "623000", hint: "Flyers, réseaux sociaux, enseigne" },
  TRANSPORT: { label: "Transport et carburant", account: "624000", hint: "Livraisons, carburant, déplacements" },
  TELECOM: { label: "Téléphone, internet, logiciels", account: "626000", hint: "Abonnements, ManaResto, Vini, OPT" },
  BANK: { label: "Frais bancaires et TPE", account: "627000", hint: "Commissions carte, frais de tenue de compte" },
  STAFF: { label: "Personnel", account: "641000", hint: "Salaires, charges, extras payés hors pointage" },
  TAXES: { label: "Impôts et taxes", account: "635000", hint: "Patente, CST, taxes diverses" },
  OTHER: { label: "Autres charges", account: "658000", hint: "Tout le reste" },
} as const;

export type ExpenseCategory = keyof typeof EXPENSE_CATEGORIES;
export const EXPENSE_CATEGORY_KEYS = Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[];
export const isExpenseCategory = (k: string): k is ExpenseCategory => k in EXPENSE_CATEGORIES;
export const expenseCategoryLabel = (k: string) => (isExpenseCategory(k) ? EXPENSE_CATEGORIES[k].label : k);
export const expenseAccount = (k: string) => (isExpenseCategory(k) ? EXPENSE_CATEGORIES[k].account : "658000");

/** Moyens de paiement d'une dépense (côté sortie d'argent). */
export const EXPENSE_METHODS = ["CASH", "CARD", "TRANSFER", "CHECK"] as const;
export type ExpenseMethod = (typeof EXPENSE_METHODS)[number];
