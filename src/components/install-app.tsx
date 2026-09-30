"use client";

import { useState, useSyncExternalStore } from "react";
import { Download, Share, SquarePlus, MoreVertical, MonitorDown, CheckCircle2, Smartphone } from "lucide-react";
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

/**
 * Bouton « Installer l'application » : sur Android/Chrome il lance l'invite native ; sur iPhone/iPad
 * (pas d'invite possible) il affiche le guide « Partager → Sur l'écran d'accueil » ; sur ordinateur, le guide Chrome/Edge.
 * Masqué quand l'application est déjà ouverte en mode installé. `autoOpen` ouvre le guide dès l'arrivée (lien depuis le site).
 */
export function InstallAppButton({ className = "", variant = "primary", label = "Installer l'application sur ce téléphone", autoOpen = false, compact = false }: { className?: string; variant?: "primary" | "secondary" | "accent" | "outline"; label?: string; autoOpen?: boolean; compact?: boolean }) {
  const { canInstall, install, standalone } = useInstallPrompt();
  const [open, setOpen] = useState(autoOpen);
  const detected = useSyncExternalStore(() => () => {}, detectPlatform, () => "desktop" as Platform);
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
        <Button type="button" variant={variant} onClick={click} className={className} data-testid="install-app">{compact ? <Smartphone className="h-4 w-4" /> : <Download className="h-4 w-4" />}{label}</Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Installer ManaResto" size="sm">
        <p className="text-sm text-muted">ManaResto s&apos;installe comme une application, sans passer par l&apos;App Store ou le Play Store : icône sur l&apos;écran d&apos;accueil, plein écran, fonctionnement hors ligne.</p>
        <div className="mt-3 flex gap-1 rounded-xl surface-2 p-1">
          {([["ios", "iPhone / iPad"], ["android", "Android"], ["desktop", "Ordinateur"]] as [Platform, string][]).map(([k, l]) => <button key={k} onClick={() => setPlatform(k)} className={`touch h-9 flex-1 rounded-lg text-xs font-bold ${platform === k ? "surface shadow-soft" : "text-muted"}`}>{l}</button>)}
        </div>
        {platform === "ios" ? (
          <ol className="mt-4 space-y-3 text-sm">
            <Step n={1} icon={<Share className="h-5 w-5" />}>Ouvrez cette page dans <b>Safari</b>, puis touchez le bouton <b>Partager</b> (le carré avec une flèche, en bas de l&apos;écran sur iPhone, en haut sur iPad).</Step>
            <Step n={2} icon={<SquarePlus className="h-5 w-5" />}>Faites défiler la liste et touchez <b>« Sur l&apos;écran d&apos;accueil »</b>.</Step>
            <Step n={3} icon={<CheckCircle2 className="h-5 w-5" />}>Touchez <b>Ajouter</b> en haut à droite. L&apos;icône ManaResto apparaît sur votre écran d&apos;accueil.</Step>
          </ol>
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

function Step({ n, icon, children }: { n: number; icon: React.ReactNode; children: React.ReactNode }) {
  return <li className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lagon-500/12 text-lagon-700 dark:text-lagon-300">{icon}</span><span><b className="mr-1">{n}.</b>{children}</span></li>;
}
