"use client";

import { Suspense, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { StaffPortal } from "@/components/portal/staff-portal";
import { PORTALS, rememberedPortal } from "@/components/portal/portals";

const noop = () => () => {};

/**
 * Portail de la caisse. Un appareil dont le dernier portail utilisé est la salle ou la cuisine y retourne
 * directement (ex. la tablette d'un serveur après « Changer d'utilisateur »).
 */
function CashPortal() {
  const router = useRouter();
  // undefined côté serveur : rien n'est affiché tant que le choix mémorisé de l'appareil n'est pas connu
  const remembered = useSyncExternalStore(noop, () => rememberedPortal() ?? "caisse", () => undefined);
  const elsewhere = remembered && remembered !== "caisse" ? remembered : null;
  useEffect(() => {
    if (elsewhere) router.replace(PORTALS[elsewhere].path + window.location.search);
  }, [elsewhere, router]);
  if (!remembered || elsewhere) return <main className="min-h-dvh bg-nuit-950" />;
  return <StaffPortal mode="caisse" />;
}

export default function PosLoginPage() {
  return <Suspense><CashPortal /></Suspense>;
}
