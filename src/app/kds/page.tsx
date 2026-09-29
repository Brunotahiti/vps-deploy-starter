import type { Metadata } from "next";
import { KdsScreen } from "@/components/kds/kds-screen";

export const metadata: Metadata = { title: "Cuisine" };

/** Écran cuisine (KDS) : tickets par poste, ACCEPTER / EN PRÉPARATION / PRÊT / TERMINÉ, alertes de temps. */
export default function KdsPage() {
  return <KdsScreen />;
}
