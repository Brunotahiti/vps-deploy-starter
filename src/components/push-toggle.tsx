"use client";

import { useState } from "react";
import { Bell, BellOff, BellRing, X } from "lucide-react";
import { usePush } from "@/hooks/use-push";
import { useToast } from "@/components/ui/toast";

const HELP: Record<string, string> = {
  denied: "Les notifications sont bloquées pour ManaResto dans les réglages du navigateur ou du téléphone : réautorisez-les puis réessayez.",
  unsupported: "Ce navigateur ne prend pas en charge les notifications. Sur iPhone et iPad, installez d'abord l'application (Partager → Sur l'écran d'accueil) puis ouvrez-la depuis l'écran d'accueil.",
  disabled: "Les notifications push ne sont pas configurées sur ce serveur (clés VAPID) : voir la documentation de déploiement.",
};

/**
 * Bouton « Alertes plat prêt » : active ou coupe les notifications push sur cet appareil.
 * Rangée du menu (par défaut) ou simple icône (`compact`) dans un en-tête.
 */
export function PushToggle({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const { state, busy, subscribe, unsubscribe } = usePush();
  const { toast } = useToast();
  if (state === "disabled" || state === "loading") return null;
  const on = state === "on";
  const click = async () => {
    if (state === "denied" || state === "unsupported") return toast(HELP[state], "info");
    if (on) { await unsubscribe(); return toast("Alertes « plat prêt » coupées sur cet appareil"); }
    const ok = await subscribe();
    toast(ok ? "Vous serez prévenu(e) dès qu'un plat est prêt, même l'écran éteint 🔔" : "Activation impossible : autorisez les notifications quand le téléphone le demande", ok ? "success" : "error");
  };
  const Icon = on ? BellRing : state === "denied" || state === "unsupported" ? BellOff : Bell;
  if (compact) {
    return <button type="button" onClick={click} disabled={busy} aria-pressed={on} aria-label={on ? "Alertes plat prêt activées" : "Activer les alertes plat prêt"} title={on ? "Alertes « plat prêt » activées sur cet appareil" : "Être prévenu(e) quand un plat est prêt"} className={`touch flex h-11 w-11 items-center justify-center rounded-2xl ${on ? "bg-green-500/15 text-green-600" : "card text-muted"} disabled:opacity-60 ${className}`} data-testid="push-toggle"><Icon className={`h-5 w-5 ${on ? "" : ""}`} /></button>;
  }
  return (
    <button type="button" onClick={click} disabled={busy} aria-pressed={on} className={`touch flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold ${on ? "bg-green-500/10 text-green-700 dark:text-green-300" : "surface-2"} disabled:opacity-60 ${className}`} data-testid="push-toggle">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1"><span className="block truncate">Alertes « plat prêt »</span><span className="block truncate text-[11px] font-medium text-muted">{on ? "Activées sur cet appareil" : state === "denied" ? "Bloquées par le navigateur" : state === "unsupported" ? "Non prises en charge ici" : "Notification même l'écran éteint"}</span></span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold ${on ? "bg-green-500 text-white" : "bg-lagon-500/15 text-brand"}`}>{on ? "ON" : "Activer"}</span>
    </button>
  );
}

const DISMISS_KEY = "mr-push-banner-dismissed";

/** Invitation à activer les alertes (portail serveur) : affichée tant que l'appareil n'est pas abonné, masquable. */
export function PushBanner({ className = "" }: { className?: string }) {
  const { state, busy, subscribe } = usePush();
  const { toast } = useToast();
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; } });
  if (hidden || state !== "off") return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(DISMISS_KEY, "1"); } catch { /* stockage indisponible */ } };
  const go = async () => {
    const ok = await subscribe();
    toast(ok ? "Vous serez prévenu(e) dès qu'un plat est prêt 🔔" : "Activation impossible : autorisez les notifications quand le téléphone le demande", ok ? "success" : "error");
    if (ok) dismiss();
  };
  return (
    <div className={`flex items-center gap-3 rounded-2xl border border-lagon-500/30 bg-lagon-500/10 p-3 ${className}`} role="status" data-testid="push-banner">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-glow"><BellRing className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1 text-sm"><b>Être prévenu(e) quand un plat est prêt</b><span className="block text-xs text-muted">Une notification sur ce téléphone, même l&apos;écran éteint.</span></span>
      <button type="button" onClick={go} disabled={busy} className="touch h-10 shrink-0 rounded-xl bg-brand px-3 text-sm font-bold text-white disabled:opacity-60">Activer</button>
      <button type="button" onClick={dismiss} className="touch flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted" aria-label="Plus tard"><X className="h-4 w-4" /></button>
    </div>
  );
}
