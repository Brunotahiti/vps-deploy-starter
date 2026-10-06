"use client";

import { useSession } from "@/hooks/use-session";
import { Spinner } from "@/components/ui/misc";
import { FloorPlan } from "./floor";
import { CounterHome } from "./counter-home";

/** Page d'accueil de la caisse : prise de commande au comptoir en mode roulotte, plan de salle sinon. */
export function PosHome() {
  const { me, isLoading, payAtOrder } = useSession();
  if (isLoading && !me) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  return payAtOrder ? <CounterHome /> : <FloorPlan />;
}
