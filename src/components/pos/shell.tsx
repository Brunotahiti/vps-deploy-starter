"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, ListOrdered, Wallet, Settings, Moon, Sun, LogOut, Wifi, WifiOff, RefreshCw, ChefHat, Download } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { useRealtime } from "@/hooks/use-realtime";
import { useTheme } from "@/hooks/use-theme";
import { useOffline } from "@/lib/offline/provider";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { api } from "@/lib/api-client";
import { Money } from "@/components/money";
import type { SessionReport } from "@/components/pos/types";

export function PosShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { me, can } = useSession();
  const { toggle } = useTheme();
  const { online, pending, syncing, flush } = useOffline();
  const connected = useRealtime(!!me?.user);
  const { canInstall, install } = useInstallPrompt();
  const cash = useQuery({ queryKey: ["cash", "current"], queryFn: () => api.get<SessionReport | null>("/api/cash/current"), enabled: !!me?.user });

  if (pathname === "/pos/login") return <>{children}</>;

  const logout = async () => {
    await api.post("/api/auth/logout");
    qc.clear();
    router.replace(me?.terminal ? "/pos/login" : "/login");
  };

  const nav = [
    { href: "/pos", label: "Salle", icon: LayoutGrid },
    { href: "/pos/orders", label: "Commandes", icon: ListOrdered },
    { href: "/pos/cash", label: "Caisse", icon: Wallet },
  ];
  const isActive = (href: string) => (href === "/pos" ? pathname === "/pos" || pathname.startsWith("/pos/order/") : pathname.startsWith(href));

  return (
    <div className="flex h-dvh flex-col">
      <header className="no-print flex h-14 shrink-0 items-center gap-2 border-b border-line surface px-3">
        <Link href="/pos" className="mr-2 flex items-center gap-2 font-extrabold tracking-tight"><span className="text-lagon-500">Mana</span>Resto</Link>
        <span className="hidden truncate text-sm text-muted sm:block">{me?.establishment?.name}</span>
        <nav className="ml-auto flex items-center gap-1">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={`touch flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold ${isActive(n.href) ? "bg-lagon-600 text-white" : "hover:surface-2"}`}>
              <n.icon className="h-4 w-4" /><span className="hidden md:inline">{n.label}</span>
            </Link>
          ))}
          {can("kds.use") ? <Link href="/kds" className="touch flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:surface-2" title="Écran cuisine"><ChefHat className="h-4 w-4" /></Link> : null}
          {can("reports.view") || can("catalog.manage") ? <Link href="/admin" className="touch flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:surface-2" title="Administration"><Settings className="h-4 w-4" /></Link> : null}
        </nav>
        <div className="ml-2 flex items-center gap-2 border-l border-line pl-2">
          <button onClick={() => (pending > 0 ? flush() : undefined)} className={`touch flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold ${!online ? "bg-red-500/15 text-red-600 dark:text-red-400" : pending > 0 ? "bg-orange-500/15 text-orange-600" : connected ? "text-green-600 dark:text-green-400" : "text-muted"}`} title={online ? (connected ? "En ligne, temps réel actif" : "En ligne") : "Hors ligne : les opérations sont mises en file d'attente"}>
            {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            <span className="hidden sm:inline">{!online ? "HORS LIGNE" : "EN LIGNE"}{pending > 0 ? ` · ${pending} à synchroniser` : ""}</span>
            {syncing ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
          </button>
          <Link href="/pos/cash" className={`hidden h-9 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-xs font-semibold md:flex ${cash.data ? "bg-lagon-500/10 text-lagon-700 dark:text-lagon-300" : "bg-orange-500/15 text-orange-600"}`}>
            {cash.data ? <><span className="hidden lg:inline">Caisse ouverte ·</span><Money amount={cash.data.summary.cashExpected} /></> : "Caisse fermée"}
          </Link>
          {canInstall ? <button onClick={install} className="touch flex h-9 items-center gap-1 rounded-lg bg-corail-500/15 px-2 text-xs font-bold text-corail-600" title="Installer ManaResto sur cet appareil"><Download className="h-4 w-4" /><span className="hidden sm:inline">Installer</span></button> : null}
          <button onClick={toggle} className="touch rounded-lg p-2 hover:surface-2" aria-label="Changer de thème"><Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" /></button>
          <button onClick={logout} className="touch flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold hover:surface-2" title="Changer d'utilisateur">
            <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: me?.user?.color ?? "#0ea5a4" }}>{(me?.user?.displayName || me?.user?.firstName || "?").slice(0, 1)}</span>
            <span className="hidden lg:inline">{me?.user?.displayName || me?.user?.firstName}</span>
            <LogOut className="h-4 w-4 text-muted" />
          </button>
        </div>
      </header>
      <main className="min-h-0 flex-1">{children}</main>
    </div>
  );
}
