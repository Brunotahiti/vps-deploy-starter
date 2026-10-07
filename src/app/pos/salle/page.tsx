import type { Metadata } from "next";
import { RoulotteFloor } from "@/components/pos/roulotte-floor";

export const metadata: Metadata = { title: "Salle" };

/** Mode roulotte : les plats prêts en cuisine, avec la table où les apporter. */
export default function RoulotteFloorPage() { return <RoulotteFloor />; }
