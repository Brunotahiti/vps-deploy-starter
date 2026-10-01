import type { Metadata } from "next";
import { Suspense } from "react";
import { StaffPortal } from "@/components/portal/staff-portal";

export const metadata: Metadata = { title: "Cuisine · Connexion" };

/** Portail de la cuisine : connexion par PIN, puis les tickets. */
export default function KitchenLoginPage() {
  return <Suspense><StaffPortal mode="cuisine" /></Suspense>;
}
