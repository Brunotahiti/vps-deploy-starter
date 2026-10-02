/** Types partagés de l'écran cuisine (miroir des réponses API). */
import type { KitchenTicketView } from "@/server/services/kitchen";
import type { kitchenSummary } from "@/server/services/kitchen";

export type KitchenTicket = KitchenTicketView;
export type KitchenSummary = Awaited<ReturnType<typeof kitchenSummary>>;

export const TICKET_STATUS_LABEL: Record<KitchenTicket["status"], string> = {
  NEW: "Nouveau", ACCEPTED: "Accepté", IN_PROGRESS: "En préparation", READY: "Prêt", DONE: "Terminé", CANCELLED: "Annulé",
};

export type KitchenChange = Awaited<ReturnType<typeof import("@/server/services/kitchen-changes").listKitchenChanges>>[number];

