/** Types partagés côté client (miroir des réponses API). */
import type { OrderWithDetails } from "@/server/services/orders";
import type { getPosCatalog } from "@/server/services/catalog";
import type { getFloorStatus } from "@/server/services/floor";
import type { getSessionReport } from "@/server/services/cash";
import type { DailySummary } from "@/server/services/reports";

export type Order = OrderWithDetails;
export type OrderItem = Order["items"][number];
export type PosCatalog = Awaited<ReturnType<typeof getPosCatalog>>;
export type PosProduct = PosCatalog["products"][number];
export type PosMenu = PosCatalog["menus"][number];
export type FloorStatus = Awaited<ReturnType<typeof getFloorStatus>>;
export type FloorTable = FloorStatus["rooms"][number]["tables"][number];
export type SessionReport = Awaited<ReturnType<typeof getSessionReport>>;
export type { DailySummary };

export const TABLE_STATUS_LABEL: Record<FloorTable["status"], string> = {
  FREE: "Libre", OCCUPIED: "Occupée", ORDERING: "Commande en cours", SENT: "Plats envoyés", BILL: "Addition demandée", RESERVED: "Réservée", TO_CLEAN: "À nettoyer",
};
export const TABLE_STATUS_COLOR: Record<FloorTable["status"], string> = {
  FREE: "#22c55e", OCCUPIED: "#f59e0b", ORDERING: "#f97316", SENT: "#3b82f6", BILL: "#a855f7", RESERVED: "#64748b", TO_CLEAN: "#ef4444",
};
export const PAYMENT_LABEL: Record<string, string> = {
  CASH: "Espèces", CARD: "Carte bancaire", CHECK: "Chèque", TRANSFER: "Virement", MEAL_VOUCHER: "Ticket restaurant", COMPLIMENTARY: "Offert", OTHER: "Autre",
};
export const ORDER_STATUS_LABEL: Record<string, string> = { OPEN: "En cours", SENT: "Envoyée", BILL_REQUESTED: "Addition", PAID: "Payée", CANCELLED: "Annulée" };
export const ORDER_TYPE_LABEL: Record<string, string> = { DINE_IN: "Sur place", COUNTER: "Comptoir", TAKEAWAY: "À emporter", DELIVERY: "Livraison", ONLINE: "En ligne", KIOSK: "Borne" };
