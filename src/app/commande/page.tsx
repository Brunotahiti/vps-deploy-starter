import type { Metadata } from "next";
import { Suspense } from "react";
import { StaffPortal } from "@/components/portal/staff-portal";

export const metadata: Metadata = { title: "Commande en salle · Connexion" };

/** Portail de prise de commande sur téléphone : connexion par PIN, puis les tables du serveur. */
export default function OrderTakingLoginPage() {
  return <Suspense><StaffPortal mode="commande" /></Suspense>;
}
