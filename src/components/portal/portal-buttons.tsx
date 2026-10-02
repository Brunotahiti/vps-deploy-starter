"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings, type LucideProps } from "lucide-react";
import type { ComponentType } from "react";
import { useSession } from "@/hooks/use-session";
import { PORTALS, rememberPortal, type PortalMode } from "./portals";

type Entry = { key: PortalMode | "gestion"; label: string; href: string; title: string; icon: ComponentType<LucideProps>; tile: string };

/** Gestion : carte, rapports, équipe, réglages (pas d'écran de connexion par PIN, c'est l'espace du responsable) */
const GESTION: Entry = { key: "gestion", label: "Gestion", href: "/admin", title: "Gestion : carte, rapports, équipe, réglages", icon: Settings, tile: "from-indigo-500 to-violet-600 shadow-[0_10px_30px_-10px_rgb(99_102_241/0.8)]" };

/** Portail de la page affichée (mis en évidence dans la barre) */
function activeKey(pathname: string): Entry["key"] | null {
  if (pathname.startsWith("/admin")) return "gestion";
  if (pathname.startsWith("/kds")) return "cuisine";
  if (pathname.startsWith("/pos/orders") || pathname.startsWith("/pos/cash")) return "caisse";
  if (pathname.startsWith("/pos")) return "salle";
  return null;
}

/**
 * Les quatre portails — Salle, Caisse, Cuisine, Gestion — dans une barre toujours visible en bas de toutes les pages,
 * sur ordinateur, tablette et téléphone : on sait toujours où l'on est et comment changer d'espace.
 * L'utilisateur étant déjà connecté, un portail ouvre directement son écran et devient le portail de l'appareil.
 * La barre occupe sa propre place sous le contenu (elle ne le recouvre jamais) et tient compte de la barre d'accueil de l'iPhone.
 */
export function PortalButtons({ onNavigate, className = "" }: { onNavigate?: () => void; className?: string }) {
  const { can } = useSession();
  const pathname = usePathname();
  const entries: Entry[] = [
    ...(Object.keys(PORTALS) as PortalMode[]).filter((m) => can(PORTALS[m].permission)).map((m) => ({ key: m, label: PORTALS[m].label, href: PORTALS[m].next, title: PORTALS[m].title, icon: PORTALS[m].icon, tile: PORTALS[m].tile })),
    ...(can("reports.view") || can("catalog.manage") || can("settings.manage") ? [GESTION] : []),
  ];
  // Un seul espace accessible : c'est l'écran où l'on se trouve déjà, la barre n'apporterait rien
  if (entries.length < 2) return null;
  const active = activeKey(pathname);
  return (
    <div className={`no-print flex shrink-0 justify-center px-3 pt-2 ${className}`} style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
      <nav aria-label="Portails" data-testid="portal-dock" className="flex w-full max-w-xl gap-2 rounded-[22px] bg-nuit-950/85 p-1.5 shadow-[0_16px_40px_-12px_rgb(6_10_23/0.6)] ring-1 ring-white/10 backdrop-blur-xl">
        {entries.map((e) => {
          const on = e.key === active;
          return (
            <Link key={e.key} href={e.href} title={e.title} aria-current={on ? "page" : undefined}
              onClick={() => { if (e.key !== "gestion") rememberPortal(e.key); onNavigate?.(); }}
              className={`touch flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl bg-gradient-to-br text-white transition active:scale-[0.97] ${e.tile} ${on ? "ring-2 ring-white ring-offset-2 ring-offset-nuit-950" : active ? "opacity-75 hover:opacity-100" : ""}`}>
              <e.icon className="h-5 w-5" /><span className="text-xs font-extrabold tracking-wide">{e.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
