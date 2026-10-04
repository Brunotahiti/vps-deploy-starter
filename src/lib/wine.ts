/*
 * Option « Cave à vin » : vocabulaire partagé entre le serveur et les écrans (couleurs, formats de vente,
 * conservation après ouverture, libellés).
 */

export const WINE_COLORS = ["RED", "WHITE", "ROSE", "SPARKLING", "SWEET", "ORANGE"] as const;
export type WineColor = (typeof WINE_COLORS)[number];
export const isWineColor = (c: string): c is WineColor => (WINE_COLORS as readonly string[]).includes(c);

export const WINE_COLOR_LABEL: Record<WineColor, string> = {
  RED: "Rouge", WHITE: "Blanc", ROSE: "Rosé", SPARKLING: "Effervescent", SWEET: "Liquoreux et moelleux", ORANGE: "Orange",
};
/** Titre des rubriques de la carte des vins */
export const WINE_COLOR_PLURAL: Record<WineColor, string> = {
  RED: "Vins rouges", WHITE: "Vins blancs", ROSE: "Vins rosés", SPARKLING: "Bulles", SWEET: "Liquoreux et moelleux", ORANGE: "Vins orange",
};
/** Pastille de couleur (écrans) */
export const WINE_COLOR_DOT: Record<WineColor, string> = {
  RED: "#9f1239", WHITE: "#eab308", ROSE: "#f472b6", SPARKLING: "#facc15", SWEET: "#d97706", ORANGE: "#ea580c",
};

/** Conservation conseillée d'une bouteille ouverte (jours), réglable vin par vin. */
export const DEFAULT_KEEP_DAYS: Record<WineColor, number> = { SPARKLING: 1, WHITE: 3, ROSE: 3, RED: 3, ORANGE: 3, SWEET: 7 };
export const keepDaysOf = (w: { color: string; keepDays: number | null }) => w.keepDays ?? (isWineColor(w.color) ? DEFAULT_KEEP_DAYS[w.color] : 3);

export const WINE_SERVINGS = ["BOTTLE", "GLASS", "CARAFE"] as const;
export type WineServing = (typeof WINE_SERVINGS)[number];
export const WINE_SERVING_LABEL: Record<WineServing, string> = { BOTTLE: "Bouteille", GLASS: "Verre", CARAFE: "Carafe" };
export const DEFAULT_SERVING_ML: Record<Exclude<WineServing, "BOTTLE">, number> = { GLASS: 120, CARAFE: 500 };

/** Contenances courantes d'une bouteille (ml) */
export const BOTTLE_SIZES = [{ ml: 375, label: "Demi-bouteille 37,5 cl" }, { ml: 500, label: "50 cl" }, { ml: 750, label: "Bouteille 75 cl" }, { ml: 1500, label: "Magnum 1,5 l" }] as const;

/** Sorties de cave autres que la vente */
export const WINE_REMOVALS = { BREAKAGE: "Casse", LOSS: "Perte (bouchonné, abîmé)", INTERNAL_USE: "Dégustation, usage interne" } as const;
export type WineRemoval = keyof typeof WINE_REMOVALS;

/** « Domaine — Cuvée 2019 » */
export function wineLabel(w: { producer?: string | null; name: string; vintage?: number | null }) {
  return `${w.producer ? `${w.producer} — ` : ""}${w.name}${w.vintage ? ` ${w.vintage}` : ""}`;
}

/** Nom du produit vendu à la caisse pour un format */
export function servingProductName(w: { producer?: string | null; name: string; vintage?: number | null }, serving: WineServing, ml: number | null) {
  const label = wineLabel(w);
  if (serving === "BOTTLE") return label;
  return `${label} · ${serving === "GLASS" ? "verre" : "carafe"} ${clLabel(ml ?? DEFAULT_SERVING_ML[serving])}`;
}

/** 120 ml → « 12 cl » ; 375 ml → « 37,5 cl » */
export const clLabel = (ml: number) => `${String(Math.round(ml) / 10).replace(".", ",")} cl`;

/** Apogée : à garder, prêt à boire (apogée), à boire sans tarder. */
export type DrinkWindow = "KEEP" | "READY" | "LATE" | null;
export function drinkWindow(w: { drinkFrom: number | null; drinkUntil: number | null }, year: number): DrinkWindow {
  if (!w.drinkFrom && !w.drinkUntil) return null;
  if (w.drinkFrom && year < w.drinkFrom) return "KEEP";
  if (w.drinkUntil && year > w.drinkUntil) return "LATE";
  return "READY";
}
export const DRINK_WINDOW_LABEL: Record<Exclude<DrinkWindow, null>, string> = { KEEP: "À garder", READY: "À son apogée", LATE: "À boire sans tarder" };
