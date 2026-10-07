"use client";

import { useState, useSyncExternalStore } from "react";
import { Bell, BellOff, BellRing, X, Settings, Smartphone, RefreshCw } from "lucide-react";
import { usePush, type PushState } from "@/hooks/use-push";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

type Platform = "ios" | "android" | "desktop";
function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent) || iPadOs) return "ios";
  if (/Android/.test(navigator.userAgent)) return "android";
  return "desktop";
}
const noop = () => () => {};

/**
 * Aide quand l'appareil refuse ou ne prend pas en charge les notifications : la marche à suivre selon le téléphone,
 * puis « Réessayer » (la permission est relue au retour des Réglages).
 */
function PushHelp({ state, standalone, open, onClose, onRetry, busy }: { state: PushState; standalone: boolean; open: boolean; onClose: () => void; onRetry: () => Promise<boolean>; busy: boolean }) {
  const detected = useSyncExternalStore(noop, detectPlatform, () => "desktop" as Platform);
  const [chosen, setChosen] = useState<Platform | null>(null);
  const platform = chosen ?? detected;
  const denied = state === "denied";
  return (
    <Modal open={open} onClose={onClose} title={denied ? "Notifications refusées sur cet appareil" : "Notifications non disponibles ici"} size="sm" footer={
      <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={onClose}>Plus tard</Button><Button className="flex-1" loading={busy} onClick={async () => { if (await onRetry()) onClose(); }}><RefreshCw className="h-4 w-4" />Réessayer</Button></div>
    }>
      <p className="text-sm text-muted">{denied ? "Le téléphone a refusé les notifications pour ManaResto (un appui sur « Ne pas autoriser », ou l'interrupteur coupé dans les réglages). Rien à faire côté ManaResto : il faut les réautoriser sur l'appareil, puis revenir ici." : "Ce navigateur ne sait pas recevoir de notifications. Il faut ouvrir ManaResto comme une application."}</p>
      <div className="mt-3 flex gap-1 rounded-xl surface-2 p-1">
        {([["ios", "iPhone / iPad"], ["android", "Android"], ["desktop", "Ordinateur"]] as [Platform, string][]).map(([k, l]) => <button key={k} onClick={() => setChosen(k)} className={`touch h-9 flex-1 rounded-lg text-xs font-bold ${platform === k ? "surface shadow-soft" : "text-muted"}`}>{l}</button>)}
      </div>
      <ol className="mt-3 space-y-2.5 text-sm">
        {platform === "ios" ? (denied || standalone ? (
          <>
            <li className="flex gap-2"><Settings className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span>Ouvrez <b>Réglages</b> de l&apos;iPhone, puis <b>Notifications</b>.</span></li>
            <li className="flex gap-2"><Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span>Faites défiler jusqu&apos;à <b>ManaResto</b> et activez <b>Autoriser les notifications</b> (bannières et sons conseillés).</span></li>
            <li className="flex gap-2"><BellRing className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span>Revenez dans ManaResto et touchez <b>Réessayer</b>.</span></li>
            <li className="rounded-xl bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-100"><b>ManaResto n&apos;apparaît pas dans la liste ?</b> Supprimez l&apos;icône ManaResto de l&apos;écran d&apos;accueil, puis réinstallez-la depuis Safari (Partager → Sur l&apos;écran d&apos;accueil), ouvrez-la depuis l&apos;icône et touchez la cloche : l&apos;iPhone pose alors la question, répondez <b>Autoriser</b>.</li>
            <li className="rounded-xl bg-lagon-500/10 p-2.5 text-xs text-muted">Il faut iOS 16.4 ou plus récent, et ouvrir ManaResto depuis son icône sur l&apos;écran d&apos;accueil (pas depuis Safari). Vérifiez aussi qu&apos;un mode <b>Concentration</b> ou <b>Ne pas déranger</b> ne masque pas les notifications.</li>
          </>
        ) : (
          <>
            <li className="flex gap-2"><Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span>Dans <b>Safari</b>, touchez <b>Partager</b> puis <b>Sur l&apos;écran d&apos;accueil</b> : ManaResto s&apos;installe comme une application.</span></li>
            <li className="flex gap-2"><BellRing className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span>Ouvrez-la depuis l&apos;écran d&apos;accueil et activez les alertes : le téléphone demande alors l&apos;autorisation (iOS 16.4 ou plus récent).</span></li>
          </>
        )) : platform === "android" ? (
          <>
            <li className="flex gap-2"><Settings className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span>Dans Chrome, touchez le <b>cadenas</b> (ou ⋮ → Paramètres du site) à côté de l&apos;adresse, puis <b>Notifications → Autoriser</b>.</span></li>
            <li className="flex gap-2"><Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span>Application installée : <b>Réglages Android → Applications → ManaResto → Notifications</b>, activez-les.</span></li>
            <li className="flex gap-2"><BellRing className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span>Revenez ici et touchez <b>Réessayer</b>.</span></li>
          </>
        ) : (
          <>
            <li className="flex gap-2"><Settings className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span>Cliquez sur le <b>cadenas</b> ou l&apos;icône de réglages à gauche de l&apos;adresse, puis <b>Notifications → Autoriser</b>.</span></li>
            <li className="flex gap-2"><BellRing className="mt-0.5 h-4 w-4 shrink-0 text-muted" /><span>Vérifiez aussi que le système laisse le navigateur afficher des notifications, puis <b>Réessayer</b>.</span></li>
          </>
        )}
      </ol>
    </Modal>
  );
}


/**
 * Bouton « Alertes plat prêt » : active ou coupe les notifications push sur cet appareil.
 * Rangée du menu (par défaut) ou simple icône (`compact`) dans un en-tête.
 */
export function PushToggle({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const { state, busy, subscribe, unsubscribe, standalone } = usePush();
  const { toast } = useToast();
  const [help, setHelp] = useState(false);
  if (state === "disabled" || state === "loading") return null;
  const on = state === "on";
  const retry = async () => {
    const ok = await subscribe();
    toast(ok ? "Vous serez prévenu(e) dès qu'un plat est prêt, même l'écran éteint 🔔" : state === "denied" ? "Toujours refusées par l'appareil : vérifiez les réglages puis réessayez" : "Activation impossible : autorisez les notifications quand le téléphone le demande", ok ? "success" : "error");
    return ok;
  };
  const click = async () => {
    if (state === "denied" || state === "unsupported") return setHelp(true);
    if (on) { await unsubscribe(); return toast("Alertes « plat prêt » coupées sur cet appareil"); }
    await retry();
  };
  const Icon = on ? BellRing : state === "denied" || state === "unsupported" ? BellOff : Bell;
  const helpModal = <PushHelp state={state} standalone={standalone} open={help} onClose={() => setHelp(false)} onRetry={retry} busy={busy} />;
  if (compact) {
    return <>
      <button type="button" onClick={click} disabled={busy} aria-pressed={on} aria-label={on ? "Alertes plat prêt activées" : "Activer les alertes plat prêt"} title={on ? "Alertes « plat prêt » activées sur cet appareil" : "Être prévenu(e) quand un plat est prêt"} className={`touch flex h-11 w-11 items-center justify-center rounded-2xl ${on ? "bg-green-500/15 text-green-600" : state === "denied" ? "bg-red-500/10 text-red-600" : "card text-muted"} disabled:opacity-60 ${className}`} data-testid="push-toggle"><Icon className="h-5 w-5" /></button>
      {helpModal}
    </>;
  }
  return (
    <>
      <button type="button" onClick={click} disabled={busy} aria-pressed={on} className={`touch flex h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold ${on ? "bg-green-500/10 text-green-700 dark:text-green-300" : "surface-2"} disabled:opacity-60 ${className}`} data-testid="push-toggle">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1"><span className="block truncate">Alertes « plat prêt »</span><span className="block truncate text-[11px] font-medium text-muted">{on ? "Activées sur cet appareil" : state === "denied" ? "Refusées par l'appareil : voir comment réautoriser" : state === "unsupported" ? "Non prises en charge ici : voir comment faire" : "Notification même l'écran éteint"}</span></span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold ${on ? "bg-green-500 text-white" : state === "denied" || state === "unsupported" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-lagon-500/15 text-brand"}`}>{on ? "ON" : state === "denied" || state === "unsupported" ? "Aide" : "Activer"}</span>
      </button>
      {helpModal}
    </>
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
