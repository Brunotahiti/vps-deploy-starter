import type { getWine, listOpenBottles, pairings, WineList, wineReport, WineSettings, WineView } from "@/server/services/wine";

/** Types des écrans de la cave à vin (les dates arrivent en texte par l'API). */
export type Wine = WineView;
export type WineDetail = Awaited<ReturnType<typeof getWine>>;
export type WineReport = Awaited<ReturnType<typeof wineReport>>;
export type OpenBottle = Awaited<ReturnType<typeof listOpenBottles>>[number];
export type Pairings = Awaited<ReturnType<typeof pairings>>;
export type { WineList, WineSettings };
