"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, ListOrdered, Wallet, Settings, Moon, Sun, LogOut, Wifi, WifiOff, RefreshCw, ChefHat, Download, Menu, X, ChevronRight, Clock, CalendarDays } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { useRealtime } from "@/hooks/use-realtime";
import { SupportBar } from "@/components/support-bar";
import { confirmLogoutWithPending, purgeLocalData } from "@/lib/offline/purge";
import { useTheme } from "@/hooks/use-theme";
import { useOffline } from "@/lib/offline/provider";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { InstallAppButton, InstallBanner } from "@/components/install-app";
import { PortalButtons } from "@/components/portal/portal-buttons";
import { Logo } from "@/components/brand";
import { api } from "@/lib/api-client";
import { Money } from "@/components/money";
import type { SessionReport } from "@/components/pos/types";
import { TodoButton, TodoPanel, useServiceReminders } from "./service-todo";

export function PosShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { me, can } = useSession();
  const { toggle } = useTheme();
  const { online, pending, syncing, flush } = useOffline();
  const connected = useRealtime(!!me?.user);
  const { canInstall, install } = useInstallPrompt();
  const posAllowed = !!me?.user && can("pos.use");
  // Phase 9 : rappels de service (« À faire maintenant »)
  const reminders = useServiceReminders(posAllowed);
  const [todo, setTodoState] = useState(false);
  const setTodo = (open: boolean) => { setTodoState(open); if (open) qc.invalidateQueries({ queryKey: ["service"] }); };
  const dueCount = reminders.data?.due.length ?? 0;
  const lateAny = reminders.data?.due.some((r) => r.late) ?? false;
  const cash = useQuery({ queryKey: ["cash", "current"], queryFn: () => api.get<SessionReport | null>("/api/cash/current"), enabled: posAllowed });
  // Un compte sans accès caisse (ex. rôle Cuisine) est envoyé vers son écran, sans charger la salle
  useEffect(() => {
    if (me?.user && !can("pos.use")) router.replace(can("kds.use") ? "/kds" : "/admin");
  }, [me, can, router]);
  // Tiroir de navigation (téléphone) : fermé automatiquement à chaque changement de page
  const [menuState, setMenuState] = useState<{ open: boolean; path: string }>({ open: false, path: pathname });
  const menu = menuState.open && menuState.path === pathname;
  const setMenu = (open: boolean) => setMenuState({ open, path: pathname });
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuState({ open: false, path: pathname }); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, pathname]);

  if (pathname === "/pos/login") return <>{children}</>;
  if (me?.user && !can("pos.use")) return <div className="flex h-dvh items-center justify-center p-6 text-center text-sm text-muted">Ce compte n&apos;a pas accès à la caisse. Redirection…</div>;

  const logout = async () => {
    if (!(await confirmLogoutWithPending())) return;
    await api.post("/api/auth/logout").catch(() => {}); // hors ligne : on nettoie quand même l'appareil
    await purgeLocalData();
    qc.clear();
    router.replace(me?.terminal ? "/pos/login" : "/login");
  };

  const nav = [
    { href: "/pos", label: "Salle", icon: LayoutGrid },
    { href: "/pos/orders", label: "Commandes", icon: ListOrdered },
    { href: "/pos/cash", label: "Caisse", icon: Wallet },
    { href: "/pos/reservations", label: "Réservations", icon: CalendarDays },
    { href: "/pos/clock", label: "Pointage", icon: Clock },
  ];
  const isActive = (href: string) => (href === "/pos" ? pathname === "/pos" || pathname.startsWith("/pos/order/") : pathname.startsWith(href));

  return (
    <div className="flex h-dvh flex-col">
      <SupportBar />
      <TodoPanel open={todo} onClose={() => setTodo(false)} data={reminders.data} />
      <header className="no-print glass flex h-14 shrink-0 items-center gap-1.5 border-b px-2 sm:h-16 sm:gap-2 sm:px-4">
        {/* Téléphone : le menu s'ouvre à gauche, comme dans l'administration */}
        <button onClick={() => setMenu(true)} className="touch flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-glow active:scale-95 sm:hidden" aria-label="Ouvrir le menu"><Menu className="h-5 w-5" /></button>
        <Link href="/pos" className="mr-1 flex items-center gap-2"><Logo size={32} withText={false} /><span className="hidden flex-col leading-tight md:flex"><span className="text-base font-extrabold tracking-tight">Mana<span className="text-brand">Resto</span></span><span className="truncate text-[11px] font-medium text-muted">{me?.establishment?.name}</span></span></Link>
        <nav className="ml-auto hidden items-center gap-1 sm:flex">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={`touch flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold transition sm:px-3.5 ${isActive(n.href) ? "bg-brand text-white shadow-glow" : "text-muted hover:surface-2 hover:text-[var(--text)]"}`}>
              <n.icon className="h-4 w-4" /><span className="hidden lg:inline">{n.label}</span>
            </Link>
          ))}
          <TodoButton count={dueCount} late={lateAny} onClick={() => setTodo(true)} />
          {can("kds.use") ? <Link href="/kds" className="touch flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:surface-2" title="Écran cuisine"><ChefHat className="h-4 w-4" /></Link> : null}
          {can("reports.view") || can("catalog.manage") ? <Link href="/admin" className="touch flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold hover:surface-2" title="Administration"><Settings className="h-4 w-4" /></Link> : null}
        </nav>
        {/* Téléphone : nom de l'écran, état réseau, bouton menu */}
        <span className="ml-1 truncate text-base font-extrabold sm:hidden">{pathname.startsWith("/pos/order/") ? "Commande" : (nav.find((n) => isActive(n.href))?.label ?? "")}</span>
        <div className="ml-auto flex items-center gap-1.5 sm:hidden">
          <TodoButton count={dueCount} late={lateAny} onClick={() => setTodo(true)} compact />
          <button onClick={() => (pending > 0 ? flush() : undefined)} className={`touch flex h-9 w-9 items-center justify-center rounded-full ${!online ? "bg-red-500/15 text-red-600" : pending > 0 ? "bg-orange-500/15 text-orange-600" : connected ? "bg-green-500/10 text-green-600" : "surface-2 text-muted"}`} aria-label={online ? "En ligne" : "Hors ligne"}>
            {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}{pending > 0 ? <span className="absolute -mt-6 ml-6 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-extrabold text-white">{pending}</span> : null}
          </button>
        </div>
        <div className="ml-1 hidden items-center gap-1 border-l border-line pl-1.5 sm:ml-2 sm:flex sm:gap-2 sm:pl-2">
          <button data-testid="network-status" data-online={online ? "true" : "false"} aria-label={`${!online ? "Hors ligne" : "En ligne"}${pending > 0 ? ` · ${pending} à synchroniser` : ""}`} onClick={() => (pending > 0 ? flush() : undefined)} className={`touch flex h-9 items-center gap-1.5 rounded-full px-3 text-[11px] font-bold tracking-wide ${!online ? "bg-red-500/15 text-red-600 dark:text-red-400" : pending > 0 ? "bg-orange-500/15 text-orange-600" : connected ? "bg-green-500/10 text-green-600 dark:text-green-400" : "surface-2 text-muted"}`} title={online ? (connected ? "En ligne, temps réel actif" : "En ligne") : "Hors ligne : les opérations sont mises en file d'attente"}>
            {online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            <span className="hidden xl:inline">{!online ? "HORS LIGNE" : "EN LIGNE"}{pending > 0 ? ` · ${pending} à synchroniser` : ""}</span>{pending > 0 ? <span className="xl:hidden">{pending}</span> : null}
            {syncing ? <RefreshCw className="h-3 w-3 animate-spin" /> : null}
          </button>
          <Link href="/pos/cash" className={`hidden h-9 items-center gap-1 whitespace-nowrap rounded-full px-3 text-[11px] font-bold xl:flex ${cash.data ? "bg-lagon-500/10 text-lagon-700 dark:text-lagon-300" : "bg-orange-500/15 text-orange-600"}`}>
            {cash.data?.summary ? <><span className="hidden xl:inline">Caisse ouverte ·</span><Money amount={cash.data.summary.cashExpected} /></> : "Caisse fermée"}
          </Link>
          {canInstall ? <button onClick={install} className="touch hidden h-9 items-center gap-1 rounded-lg bg-corail-500/15 px-2 text-xs font-bold text-corail-600 xl:flex" title="Installer ManaResto sur cet appareil"><Download className="h-4 w-4" /><span className="hidden xl:inline">Installer</span></button> : null}
          <button onClick={toggle} className="touch hidden rounded-lg p-2 hover:surface-2 xl:block" aria-label="Changer de thème"><Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" /></button>
          <button onClick={logout} className="touch flex items-center gap-2 rounded-full py-1 pl-1 pr-1 text-sm font-semibold hover:surface-2 sm:pr-2.5" title="Changer d'utilisateur">
            <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white shadow-soft" style={{ background: me?.user?.color ?? "#0ea5a4" }}>{(me?.user?.displayName || me?.user?.firstName || "?").slice(0, 1)}</span>
            <span className="hidden xl:inline">{me?.user?.displayName || me?.user?.firstName}</span>
            <LogOut className="hidden h-4 w-4 text-muted sm:block" />
          </button>
        </div>
      </header>
      <InstallBanner className="mx-2 mt-2 lg:hidden" />
      <main className="relative min-h-0 flex-1 overflow-y-auto">{children}</main>
      {/* Téléphone / tablette : les portails Salle, Caisse et Cuisine restent visibles sur toutes les pages */}
      <PortalButtons variant="dock" className="lg:hidden" />

      {/* Tiroir de navigation (téléphone) : glisse depuis la gauche, comme le menu de l'administration */}
      <div className={`fixed inset-0 z-[60] sm:hidden ${menu ? "" : "pointer-events-none"}`} aria-hidden={!menu}>
        <div onClick={() => setMenu(false)} className={`absolute inset-0 bg-nuit-950/55 backdrop-blur-[2px] transition-opacity duration-300 ${menu ? "opacity-100" : "opacity-0"}`} />
        <aside className={`absolute inset-y-0 left-0 flex w-[82vw] max-w-sm flex-col surface shadow-2xl transition-transform duration-300 ease-out ${menu ? "translate-x-0" : "-translate-x-full"}`} style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }} role="dialog" aria-label="Menu">
          <div className="bg-lagoon relative overflow-hidden px-5 pb-5 pt-4 text-white">
            <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
            <div className="flex items-center justify-between"><Logo size={32} light /><button onClick={() => setMenu(false)} className="touch flex h-10 w-10 items-center justify-center rounded-xl bg-white/15" aria-label="Fermer le menu"><X className="h-5 w-5" /></button></div>
            <div className="mt-5 flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full text-base font-extrabold text-white ring-2 ring-white/40" style={{ background: me?.user?.color ?? "#0ea5a4" }}>{(me?.user?.displayName || me?.user?.firstName || "?").slice(0, 1)}</span>
              <span className="min-w-0"><span className="block truncate text-base font-extrabold">{me?.user?.displayName || `${me?.user?.firstName ?? ""} ${me?.user?.lastName ?? ""}`}</span><span className="block truncate text-xs text-lagon-100/90">{me?.establishment?.name}{me?.terminal ? ` · ${me.terminal.name}` : ""}</span></span>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto p-3">
            {[...nav, ...(can("reports.view") || can("catalog.manage") ? [{ href: "/admin", label: "Administration", icon: Settings }] : [])].map((n, i) => (
              <Link key={n.href} href={n.href} style={{ transitionDelay: menu ? `${60 + i * 40}ms` : "0ms" }} className={`mb-1.5 flex h-14 items-center gap-3 rounded-2xl px-4 text-[15px] font-bold transition-all duration-300 ${menu ? "translate-x-0 opacity-100" : "-translate-x-6 opacity-0"} ${isActive(n.href) ? "bg-brand text-white shadow-glow" : "surface-2 text-[var(--text)]"}`}>
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${isActive(n.href) ? "bg-white/15" : "surface"}`}><n.icon className="h-5 w-5" /></span>{n.label}<ChevronRight className="ml-auto h-4 w-4 opacity-60" />
              </Link>
            ))}
            {/* Les portails Salle / Caisse / Cuisine restent dans la barre du bas : pas de doublon ici */}
            <div className="mt-4 rounded-2xl border border-line p-3 text-sm">
              <div className="flex items-center justify-between"><span className="font-semibold">Caisse</span><span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${cash.data ? "bg-lagon-500/15 text-lagon-700 dark:text-lagon-300" : "bg-orange-500/15 text-orange-600"}`}>{cash.data ? <>ouverte · <Money amount={cash.data.summary.cashExpected} /></> : "fermée"}</span></div>
              <div className="mt-2 flex items-center justify-between"><span className="font-semibold">Réseau</span><span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${!online ? "bg-red-500/15 text-red-600" : "bg-green-500/10 text-green-600"}`}>{online ? (connected ? "en ligne · temps réel" : "en ligne") : "hors ligne"}{pending > 0 ? ` · ${pending} à synchroniser` : ""}</span></div>
              {pending > 0 && online ? <button onClick={() => flush()} className="touch mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-orange-500/15 text-xs font-bold text-orange-600"><RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />Synchroniser maintenant</button> : null}
            </div>
          </nav>
          <div className="space-y-2 border-t border-line p-3">
            <div className="flex gap-2">
              <button onClick={toggle} className="touch flex h-12 flex-1 items-center justify-center gap-2 rounded-xl surface-2 text-sm font-semibold"><Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" />Thème</button>
              <InstallAppButton variant="accent" className="h-12 flex-1" label="Installer" compact />
            </div>
            <button onClick={logout} className="touch flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-line text-sm font-bold"><LogOut className="h-4 w-4" />Changer d&apos;utilisateur</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
