import type { BusinessType, OptionKey } from "./options";

/*
 * Mise en valeur des options payantes : la promesse de chaque option (ce que le restaurateur y gagne),
 * le besoin auquel elle répond, ce qu'on conseille selon le type d'activité, et l'écran à montrer
 * dans le restaurant exemple. Des faits sur ce que fait le programme, jamais de chiffres inventés.
 */

export const GOALS = {
  sell: { label: "Vendre plus", hint: "Plus de commandes, de clients fidèles et de ventes au bar" },
  time: { label: "Gagner du temps", hint: "Moins de papier, de calculs et d'oublis" },
  steer: { label: "Piloter", hint: "Des chiffres clairs pour décider" },
  calm: { label: "Être tranquille", hint: "Coupures d'internet, contrôles sanitaires : rien ne vous arrête" },
} as const;
export type Goal = keyof typeof GOALS;

export const OPTION_PITCH: Record<OptionKey, { benefit: string; goal: Goal }> = {
  stock: { benefit: "Sachez ce qu'il reste en réserve et ce que vous coûte chaque assiette", goal: "time" },
  digital: { benefit: "Vos clients commandent et réservent seuls, même quand vous êtes débordé", goal: "sell" },
  team: { benefit: "Plannings, pointage et coût de l'équipe, sans tableau à remplir", goal: "time" },
  stats: { benefit: "Vos chiffres en clair pour décider vite : ce qui marche, ce qui coûte", goal: "steer" },
  continuity: { benefit: "Plus jamais de service bloqué par une coupure d'internet", goal: "calm" },
  ai: { benefit: "Anticipez l'affluence de la semaine et commandez juste ce qu'il faut", goal: "steer" },
  hygiene: { benefit: "Votre plan de maîtrise sanitaire tenu chaque jour, prêt pour un contrôle", goal: "calm" },
  accounts: { benefit: "Faites crédit aux entreprises et aux habitués, en gardant le contrôle", goal: "time" },
  marketing: { benefit: "Faites revenir vos clients : cartes cadeaux, campagnes et avis Google", goal: "sell" },
  screens: { benefit: "Votre carte en grand sur une télévision, toujours à jour", goal: "sell" },
  catering: { benefit: "Des devis pro pour vos événements, acomptes et factures compris", goal: "sell" },
  bar: { benefit: "Ardoises, happy hour et cave sous contrôle : un bar qui tourne", goal: "sell" },
  wine: { benefit: "Vendez mieux vos vins, au verre comme à la bouteille", goal: "sell" },
  advanced: { benefit: "Pilotez plusieurs établissements depuis un seul compte", goal: "steer" },
};

/** Conseillé en premier selon le type d'activité (dans cet ordre) ; les options actives sont écartées. */
export const RECOMMENDED: Record<BusinessType, OptionKey[]> = {
  restaurant: ["digital", "stock", "marketing", "team", "wine", "stats", "continuity"],
  snack: ["digital", "stock", "continuity", "marketing", "screens", "stats"],
  bar: ["bar", "wine", "digital", "marketing", "screens", "stock"],
};

export function recommendedFor(type: BusinessType, enabled: readonly string[], n = 3): OptionKey[] {
  return RECOMMENDED[type].filter((k) => !enabled.includes(k)).slice(0, n);
}

/** Écran à ouvrir dans le restaurant exemple pour voir l'option « en vrai ». */
export const OPTION_HOME: Record<OptionKey, string> = {
  stock: "/admin/stock", digital: "/admin/digital", team: "/admin/staff/shifts", stats: "/admin/stats", continuity: "/pos",
  ai: "/admin/ai", hygiene: "/admin/hygiene", accounts: "/admin/accounts", marketing: "/admin/marketing", screens: "/admin/screens",
  catering: "/admin/catering", bar: "/pos/bar", wine: "/admin/wine", advanced: "/admin/establishments",
};

/** Écrans de gestion réservés à une option : sans elle, ils présentent l'option au lieu d'un message d'erreur. */
const OPTION_ROUTES: [string, OptionKey][] = [
  ["/admin/stock", "stock"], ["/admin/staff", "team"], ["/admin/stats", "stats"], ["/admin/reports", "stats"], ["/admin/ai", "ai"],
  ["/admin/digital", "digital"], ["/admin/hygiene", "hygiene"], ["/admin/accounts", "accounts"], ["/admin/marketing", "marketing"],
  ["/admin/screens", "screens"], ["/admin/catering", "catering"], ["/admin/bar", "bar"], ["/admin/wine", "wine"],
];
export function optionForRoute(pathname: string): OptionKey | null {
  return OPTION_ROUTES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? null;
}
