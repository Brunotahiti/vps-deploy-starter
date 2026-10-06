import type { Metadata } from "next";
import { ServiceRecapScreen } from "@/components/pos/service-recap";

export const metadata: Metadata = { title: "Fin de service" };

/** Récapitulatif de fin de service : la journée en une page, imprimable. */
export default function ServiceRecapPage() { return <ServiceRecapScreen />; }
