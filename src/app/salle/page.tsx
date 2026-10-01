import type { Metadata } from "next";
import { Suspense } from "react";
import { StaffPortal } from "@/components/portal/staff-portal";

export const metadata: Metadata = { title: "Salle · Connexion" };

/** Portail du service en salle : connexion par PIN, puis le plan de salle. */
export default function FloorLoginPage() {
  return <Suspense><StaffPortal mode="salle" /></Suspense>;
}
