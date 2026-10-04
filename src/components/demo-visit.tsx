"use client";

import { useState } from "react";
import { ArrowLeft, Play, Radio } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { startDemoTour } from "@/components/demo-tour";

/** Ouvre le restaurant exemple en gardant sa propre session (rechargement complet : l'application repart propre). */
export async function openLiveDemo(path = "/admin") {
  await api.post("/api/auth/demo-session");
  startDemoTour();
  window.location.replace(path);
}

/**
 * Bandeau affiché pendant la visite du restaurant exemple depuis son compte : « Revenir à mon restaurant »
 * restaure sa session, sans se reconnecter.
 */
export function DemoVisitBar() {
  const { me } = useSession();
  const [busy, setBusy] = useState(false);
  const visit = me?.demoVisit;
  if (!visit) return null;
  const back = async () => {
    setBusy(true);
    try { await api.post("/api/auth/demo-return"); window.location.replace("/admin"); }
    catch { window.location.replace("/login"); }
  };
  return (
    <div role="status" data-testid="demo-visit-bar" className="no-print sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 bg-gradient-to-r from-[#0b2a3c] via-[#0f3d52] to-[#0b2a3c] px-3 py-2 text-center text-xs text-white sm:text-sm" style={{ paddingTop: "max(8px, env(safe-area-inset-top))" }}>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />Live</span>
      <span>Vous visitez le <b>restaurant exemple Le Mana Beach</b> : tout est fictif, essayez librement.</span>
      <button onClick={back} disabled={busy} className="touch inline-flex items-center gap-1.5 rounded-full bg-[#2dd4bf] px-3.5 py-1 font-extrabold text-[#042f2e] shadow-lg transition hover:brightness-105 disabled:opacity-60">
        <ArrowLeft className="h-4 w-4" />{busy ? "Retour…" : `Revenir à mon restaurant${visit.returnTo.establishmentName ? ` (${visit.returnTo.establishmentName})` : ""}`}
      </button>
    </div>
  );
}

/** Carte du tableau de bord : « Voir une session en live » (restaurant exemple en plein service). */
export function LiveDemoCard() {
  const { me } = useSession();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!me?.user || me.isDemo || me.impersonation) return null;
  const go = async () => {
    setBusy(true);
    try { await openLiveDemo(); }
    catch (e) { setBusy(false); toast(e instanceof ApiClientError ? e.message : "Ouverture impossible, réessayez", "error"); }
  };
  return (
    <section data-testid="live-demo-card" className="relative mb-4 overflow-hidden rounded-3xl bg-gradient-to-br from-[#0b2a3c] via-[#0f3d52] to-[#0b2a3c] p-5 text-white shadow-lift sm:p-6">
      <span className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[#2dd4bf]/25 blur-3xl" />
      <span className="pointer-events-none absolute -bottom-28 left-1/4 h-60 w-60 rounded-full bg-corail-400/20 blur-3xl" />
      <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
        <div className="max-w-2xl">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[#5eead4] ring-1 ring-white/15">
            <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" /></span>
            Restaurant exemple en plein service
          </p>
          <h2 className="mt-3 text-2xl font-extrabold leading-tight tracking-tight sm:text-[28px]">Voyez ManaResto tourner en vrai, sans rien saisir</h2>
          <p className="mt-2 text-sm leading-relaxed text-white/75 sm:text-[15px]">Tables occupées, tickets en cuisine, caisse, réservations et deux mois de chiffres : explorez Le Mana Beach, prenez une commande, encaissez. Tout est fictif, et un bouton vous ramène à votre restaurant à tout moment.</p>
        </div>
        <button onClick={go} disabled={busy} data-testid="live-demo-open" className="group touch inline-flex shrink-0 items-center justify-center gap-3 rounded-2xl bg-[#2dd4bf] px-6 py-4 text-base font-extrabold text-[#042f2e] shadow-[0_12px_32px_-10px_rgba(45,212,191,.8)] transition hover:-translate-y-0.5 hover:brightness-105 active:translate-y-0 disabled:opacity-70">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#042f2e] text-[#2dd4bf] transition group-hover:scale-110">{busy ? <Radio className="h-4 w-4 animate-pulse" /> : <Play className="ml-0.5 h-4 w-4 fill-current" />}</span>
          {busy ? "Ouverture…" : "Voir une session en live"}
        </button>
      </div>
    </section>
  );
}
