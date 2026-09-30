"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { LifeBuoy, LogOut } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { useHeartbeat } from "@/hooks/use-heartbeat";
import { api } from "@/lib/api-client";

/**
 * Bandeau « mode support » quand l'équipe ManaResto a pris la main sur un compte, avec retour à la console.
 * Envoie aussi le battement d'activité (sauf en mode support : le serveur l'ignore).
 */
export function SupportBar() {
  const { me } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  useHeartbeat(!!me?.user && !me?.impersonation);
  if (!me?.impersonation) return null;
  const back = async () => {
    setBusy(true);
    try { await api.post("/api/platform/return"); qc.clear(); router.replace("/platform"); router.refresh(); }
    catch { setBusy(false); router.replace("/login"); }
  };
  return (
    <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[#7c3aed] px-3 py-1.5 text-center text-xs font-semibold text-white" style={{ paddingTop: "max(6px, env(safe-area-inset-top))" }}>
      <LifeBuoy className="h-4 w-4 shrink-0" />
      <span>Mode support : vous êtes dans le compte de <b>{me.user?.firstName} {me.user?.lastName}</b> ({me.establishment?.name ?? "restaurant"})</span>
      <button onClick={back} disabled={busy} className="inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-0.5 font-bold hover:bg-white/30 disabled:opacity-60"><LogOut className="h-3.5 w-3.5" />Revenir à la console</button>
    </div>
  );
}
