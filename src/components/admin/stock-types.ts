/** Types partagés des écrans stock (miroir des réponses API). */
import type { listIngredients, listMovements, getRecipe, listSuppliers, listSupplierProducts, listPurchaseOrders, stockAlerts, stockReport, suggestPurchase, Preparation } from "@/server/services/stock";

export type Ingredient = Awaited<ReturnType<typeof listIngredients>>[number];
export type Movement = Awaited<ReturnType<typeof listMovements>>[number];
export type Recipe = Awaited<ReturnType<typeof getRecipe>>;
export type Supplier = Awaited<ReturnType<typeof listSuppliers>>[number];
export type SupplierProduct = Awaited<ReturnType<typeof listSupplierProducts>>[number];
export type PurchaseOrder = Awaited<ReturnType<typeof listPurchaseOrders>>[number];
export type StockAlerts = Awaited<ReturnType<typeof stockAlerts>>;
export type StockReport = Awaited<ReturnType<typeof stockReport>>;
export type Suggestion = Awaited<ReturnType<typeof suggestPurchase>>[number];
export type { Preparation };

export const UNIT_OPTIONS = ["pce", "g", "kg", "ml", "cl", "l", "portion"];
export const MOVEMENT_LABEL: Record<string, string> = { SALE: "Vente", PURCHASE: "Achat", ADJUSTMENT: "Ajustement", LOSS: "Perte", BREAKAGE: "Casse", INTERNAL_USE: "Usage interne", INVENTORY: "Inventaire", PRODUCTION: "Production" };
export const PO_STATUS_LABEL: Record<string, string> = { DRAFT: "Brouillon", SENT: "Envoyé", PARTIALLY_RECEIVED: "Reçu partiellement", RECEIVED: "Reçu", CANCELLED: "Annulé" };
export const fmtQty = (q: number, unit?: string) => `${Number.isInteger(q) ? q : q.toFixed(3).replace(/\.?0+$/, "")}${unit ? ` ${unit}` : ""}`;
