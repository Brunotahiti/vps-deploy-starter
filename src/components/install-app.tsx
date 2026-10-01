"use client";

import { useState, useSyncExternalStore } from "react";
import { Download, Share, SquarePlus, MoreVertical, MonitorDown, CheckCircle2, Smartphone, Compass, Maximize2, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/use-install-prompt";

type Platform = "ios" | "android" | "desktop";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  const iPadOs = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOs) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

/** Navigateur intégré à une autre application (Facebook, Messenger, Instagram, Gmail, Chrome…) : sur iPhone, seul Safari sait installer. */
function detectOtherIosBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /CriOS|FxiOS|EdgiOS|OPiOS|FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|GSA\/|WhatsApp/.test(navigator.userAgent);
}

/**
 * Bouton « Installer l'application » : sur Android/Chrome il lance l'invite native ; sur iPhone/iPad
 * (pas d'invite possible) il affiche le guide « Partager → Sur l'écran d'accueil » ; sur ordinateur, le guide Chrome/Edge.
 * Masqué quand l'application est déjà ouverte en mode installé. `autoOpen` ouvre le guide dès l'arrivée (lien depuis le site).
 */
export function InstallAppButton({ className = "", variant = "primary", label = "Installer l'application sur ce téléphone", autoOpen = false, compact = false, size }: { className?: string; variant?: "primary" | "secondary" | "accent" | "outline"; label?: string; autoOpen?: boolean; compact?: boolean; size?: "sm" | "md" }) {
  const { canInstall, install, standalone } = useInstallPrompt();
  const [open, setOpen] = useState(autoOpen);
  const detected = useSyncExternalStore(noop, detectPlatform, () => "desktop" as Platform);
  const otherIosBrowser = useSyncExternalStore(noop, detectOtherIosBrowser, () => false);
  const [chosen, setChosen] = useState<Platform | null>(null);
  const platform = chosen ?? detected;
  const setPlatform = setChosen;
  const [done, setDone] = useState(false);
  if (standalone) return null;
  const click = async () => {
    if (canInstall) { const ok = await install(); if (ok) { setDone(true); return; } }
    setOpen(true);
  };
  return (
    <>
      {done ? <p className={`flex items-center gap-2 text-sm font-semibold text-green-600 ${className}`}><CheckCircle2 className="h-4 w-4" />Application installée : ouvrez-la depuis votre écran d&apos;accueil.</p> : (
        <Button type="button" variant={variant} size={size} onClick={click} className={className} data-testid="install-app">{compact ? <Smartphone className="h-4 w-4" /> : <Download className="h-4 w-4" />}{label}</Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Installer ManaResto" size="sm">
        <p className="text-sm text-muted">ManaResto s&apos;installe comme une application, sans passer par l&apos;App Store ou le Play Store : icône sur l&apos;écran d&apos;accueil, plein écran, fonctionnement hors ligne.</p>
        <div className="mt-3 flex gap-1 rounded-xl surface-2 p-1">
          {([["ios", "iPhone / iPad"], ["android", "Android"], ["desktop", "Ordinateur"]] as [Platform, string][]).map(([k, l]) => <button key={k} onClick={() => setPlatform(k)} className={`touch h-9 flex-1 rounded-lg text-xs font-bold ${platform === k ? "surface shadow-soft" : "text-muted"}`}>{l}</button>)}
        </div>
        {platform === "ios" ? (
          <>
          {otherIosBrowser ? <p className="mt-4 flex items-start gap-2 rounded-xl bg-orange-500/12 p-3 text-sm font-semibold text-orange-700 dark:text-orange-300"><Compass className="mt-0.5 h-4 w-4 shrink-0" />Vous êtes dans le navigateur d&apos;une autre application : ouvrez d&apos;abord <b className="mx-1">app.manaresto.com</b> dans Safari (bouton boussole ou « Ouvrir dans Safari »).</p> : null}
          <ol className="mt-4 space-y-3 text-sm">
            <Step n={1} icon={<Share className="h-5 w-5" />}>Ouvrez <b>app.manaresto.com</b> dans <b>Safari</b>, puis touchez le bouton <b>Partager</b> (le carré avec une flèche, en bas de l&apos;écran sur iPhone, en haut sur iPad).</Step>
            <Step n={2} icon={<SquarePlus className="h-5 w-5" />}>Faites défiler la liste et touchez <b>« Sur l&apos;écran d&apos;accueil »</b>. Si l&apos;option <b>« Ouvrir comme app web »</b> apparaît, laissez-la activée.</Step>
            <Step n={3} icon={<CheckCircle2 className="h-5 w-5" />}>Touchez <b>Ajouter</b>. Ouvrez ensuite ManaResto <b>depuis cette icône</b> : plein écran, sans barre d&apos;adresse ni boutons du navigateur.</Step>
          </ol>
          <p className="mt-3 text-xs text-muted">Une icône ajoutée depuis le site www.manaresto.com ouvre l&apos;application dans une fenêtre de navigateur : supprimez-la et ajoutez celle de app.manaresto.com.</p>
          </>
        ) : platform === "android" ? (
          <ol className="mt-4 space-y-3 text-sm">
            {canInstall ? <li><Button className="w-full" onClick={click}><Download className="h-4 w-4" />Installer maintenant</Button></li> : null}
            <Step n={1} icon={<MoreVertical className="h-5 w-5" />}>Dans <b>Chrome</b>, touchez le menu <b>⋮</b> en haut à droite.</Step>
            <Step n={2} icon={<SquarePlus className="h-5 w-5" />}>Touchez <b>« Installer l&apos;application »</b> (ou « Ajouter à l&apos;écran d&apos;accueil »).</Step>
            <Step n={3} icon={<CheckCircle2 className="h-5 w-5" />}>Confirmez avec <b>Installer</b>. L&apos;icône ManaResto apparaît sur votre écran d&apos;accueil.</Step>
          </ol>
        ) : (
          <ol className="mt-4 space-y-3 text-sm">
            {canInstall ? <li><Button className="w-full" onClick={click}><Download className="h-4 w-4" />Installer maintenant</Button></li> : null}
            <Step n={1} icon={<MonitorDown className="h-5 w-5" />}>Dans <b>Chrome</b> ou <b>Edge</b>, cliquez sur l&apos;icône d&apos;installation à droite de la barre d&apos;adresse (ou menu ⋮ → « Installer ManaResto »).</Step>
            <Step n={2} icon={<CheckCircle2 className="h-5 w-5" />}>Confirmez : ManaResto s&apos;ouvre dans sa propre fenêtre, avec une icône dans le Dock ou la barre des tâches.</Step>
          </ol>
        )}
      </Modal>
    </>
  );
}

function noop() { return () => {}; }

const BANNER_KEY = "mr-install-banner-hidden";

/**
 * Bandeau « plein écran » sur téléphone et tablette quand ManaResto est ouvert dans le navigateur (barre d'adresse,
 * boutons Safari) : une page web ne peut pas masquer ces barres, seule l'application installée s'ouvre en plein écran.
 * Masquable 7 jours ; jamais affiché dans l'application installée ni sur ordinateur.
 */
export function InstallBanner({ className = "" }: { className?: string }) {
  const { standalone } = useInstallPrompt();
  const platform = useSyncExternalStore(noop, detectPlatform, () => "desktop" as Platform);
  const [hiddenNow, setHiddenNow] = useState(false);
  const hiddenStored = useSyncExternalStore(noop, () => { try { return Number(localStorage.getItem(BANNER_KEY) ?? 0) > Date.now(); } catch { return false; } }, () => true);
  if (standalone || platform === "desktop" || hiddenStored || hiddenNow) return null;
  const hide = () => { try { localStorage.setItem(BANNER_KEY, String(Date.now() + 7 * 86_400_000)); } catch { /* stockage indisponible */ } setHiddenNow(true); };
  return (
    <div className={`no-print flex items-center gap-2 rounded-2xl bg-lagon-500/10 p-2 pl-3 text-sm ring-1 ring-lagon-500/20 ${className}`} data-testid="install-banner">
      <Maximize2 className="h-4 w-4 shrink-0 text-lagon-600 dark:text-lagon-300" />
      <span className="min-w-0 flex-1 leading-tight"><b>Plein écran</b><span className="block text-xs text-muted">Sans les barres du navigateur : installez l&apos;application</span></span>
      <InstallAppButton size="sm" label="Installer" compact className="shrink-0" />
      <button onClick={hide} className="touch flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted hover:surface-2" aria-label="Masquer"><X className="h-4 w-4" /></button>
    </div>
  );
}

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return <li className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lagon-500/12 text-lagon-700 dark:text-lagon-300">{icon}</span><span><b className="mr-1">{n}.</b>{children}</span></li>;
}
