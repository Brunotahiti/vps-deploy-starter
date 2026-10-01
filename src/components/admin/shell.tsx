"use client";

import { VersionBadge } from "@/components/version-badge";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, UtensilsCrossed, Map, Receipt, Wallet, Users, Settings, ScrollText, Building2, Moon, Sun, LogOut, Menu, X, Boxes, CalendarDays, Heart, QrCode, BarChart3, Clock, Plug, Network, TrendingUp, ShieldCheck, Printer, ChevronDown, Store, BookOpen, UsersRound, SlidersHorizontal, Globe, ExternalLink, type LucideIcon } from "lucide-react";
import { markLogoutPending, useSession } from "@/hooks/use-session";
import { useRealtime } from "@/hooks/use-realtime";
import { useTheme } from "@/hooks/use-theme";
import { InstallAppButton, InstallBanner } from "@/components/install-app";
import { BUILD_ID } from "@/lib/build";
import { SubscriptionBanner } from "@/components/admin/subscription";
import { api } from "@/lib/api-client";
import { Logo } from "@/components/brand";
import { Spinner } from "@/components/ui/misc";
import { SupportBar } from "@/components/support-bar";
import { DemoVisitBar } from "@/components/demo-visit";
import { PortalButtons } from "@/components/portal/portal-buttons";
import { confirmLogoutWithPending, purgeLocalData } from "@/lib/offline/purge";

type NavItem = { href: string; label: string; icon: LucideIcon; show?: boolean; match?: string; external?: boolean };
type NavGroup = { key: string; label: string; icon: LucideIcon; items: NavItem[] };

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { me, can, isLoading } = useSession();
  const { toggle } = useTheme();
  const [open, setOpen] = useState(false);
  // undefined : la rubrique de la page ouverte est dépliée ; sinon la rubrique choisie (null : toutes repliées)
  const [openGroup, setOpenGroup] = useState<string | null | undefined>(undefined);
  useRealtime(!!me?.user);

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;

  // Menu court : le tableau de bord, puis cinq rubriques repliables (celle de la page ouverte est dépliée)
  const groups: NavGroup[] = [
    { key: "ventes", label: "Ventes", icon: Store, items: [
      { href: "/admin/orders", label: "Commandes", icon: Receipt, show: can("orders.view_history") },
      { href: "/admin/cash", label: "Caisse", icon: Wallet, show: can("reports.view") },
      { href: "/admin/stats", label: "Statistiques", icon: TrendingUp, show: can("reports.view") },
      { href: "/admin/reports", label: "Rapports & exports", icon: BarChart3, show: can("reports.view") },
    ] },
    { key: "carte", label: "Carte & stocks", icon: BookOpen, items: [
      { href: "/admin/catalog/products", label: "Catalogue", icon: UtensilsCrossed, show: can("catalog.view"), match: "/admin/catalog" },
      { href: "/admin/stock", label: "Stocks & achats", icon: Boxes, show: can("stock.view"), match: "/admin/stock" },
    ] },
    { key: "clients", label: "Salle & clients", icon: Heart, items: [
      { href: "/admin/floor", label: "Plan de salle", icon: Map, show: can("floor.manage") },
      { href: "/pos/reservations", label: "Réservations", icon: CalendarDays, show: can("pos.use") },
      { href: "/admin/customers", label: "Clients & fidélité", icon: Heart, show: can("customers.manage") },
      { href: "/admin/digital", label: "QR & commande en ligne", icon: QrCode, show: can("settings.manage") },
      { href: me?.publicSitePath ?? "", label: "Voir mon site en ligne", icon: Globe, show: !!me?.publicSitePath, external: true },
    ] },
    { key: "equipe", label: "Équipe", icon: UsersRound, items: [
      { href: "/admin/staff", label: "Personnel & planning", icon: Clock, show: can("staff.manage"), match: "/admin/staff" },
      { href: "/admin/users", label: "Accès & PIN", icon: Users, show: can("users.manage") },
    ] },
    { key: "reglages", label: "Réglages", icon: SlidersHorizontal, items: [
      { href: "/admin/settings", label: "Paramètres", icon: Settings, show: can("settings.manage") },
      { href: "/admin/hardware", label: "Imprimantes & tiroir", icon: Printer, show: can("settings.manage") },
      { href: "/admin/integrations", label: "Intégrations", icon: Plug, show: can("settings.manage") },
      { href: "/admin/establishments", label: "Établissements", icon: Building2, show: can("establishments.manage") || (me?.establishments?.length ?? 0) > 1 },
      { href: "/admin/organization", label: "Multi-sites", icon: Network, show: can("reports.view_global") },
      { href: "/admin/audit", label: "Journal d'audit", icon: ScrollText, show: can("audit.view") },
    ] },
  ].map((g) => ({ ...g, items: g.items.filter((n) => n.show) })).filter((g) => g.items.length > 0);
  const isActive = (n: NavItem) => (n.match ? pathname.startsWith(n.match) : pathname === n.href);
  const activeGroup = groups.find((g) => g.items.some(isActive))?.key ?? null;
  const isOpen = (key: string) => (openGroup === undefined ? activeGroup === key : openGroup === key);
  const link = (n: NavItem, nested = false) => {
    // Site public : nouvel onglet, l'administration reste ouverte
    if (n.external) return <a key={n.href} href={n.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={`mb-0.5 flex items-center gap-3 rounded-xl px-3 text-sm font-semibold text-lagon-700 transition hover:surface-2 dark:text-lagon-300 ${nested ? "h-10 pl-5" : "h-11"}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${nested ? "" : "surface-2"}`}><n.icon className="h-4 w-4" /></span>{n.label}<ExternalLink className="ml-auto h-3.5 w-3.5 opacity-70" /></a>;
    const active = isActive(n);
    return <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={`mb-0.5 flex items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${nested ? "h-10 pl-5" : "h-11"} ${active ? "bg-brand text-white shadow-glow" : "text-muted hover:surface-2 hover:text-[var(--text)]"}`}><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${active ? "bg-white/15" : nested ? "" : "surface-2"}`}><n.icon className="h-4 w-4" /></span>{n.label}</Link>;
  };

  const switchEst = async (id: string) => { try { await api.post("/api/auth/switch-establishment", { establishmentId: id }); } catch { return; } await purgeLocalData(); qc.clear(); router.refresh(); qc.invalidateQueries(); };
  const logout = async () => { if (!(await confirmLogoutWithPending())) return; await api.post("/api/auth/logout").catch(() => markLogoutPending()); await purgeLocalData(); qc.clear(); window.location.replace("/login"); }; // rechargement complet : état propre, même sans réseau

  const Sidebar = (
    <aside className="flex h-full w-[268px] flex-col border-r border-line surface">
      <div className="flex h-16 items-center justify-between px-5"><span className="flex items-center gap-2"><Logo size={34} /><VersionBadge /></span><button className="touch rounded-lg p-2 lg:hidden" aria-label="Fermer le menu" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button></div>
      {me?.establishments && me.establishments.length > 1 ? (
        <select value={me.establishment?.id ?? ""} onChange={(e) => switchEst(e.target.value)} className="mx-3 mb-2 h-10 rounded-lg border border-line surface-2 px-2 text-sm font-semibold">
          {me.establishments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      ) : <p className="mx-4 mb-2 truncate text-sm font-semibold text-muted">{me?.establishment?.name}</p>}
      <nav className="flex-1 overflow-y-auto px-2" aria-label="Menu">
        {can("reports.view") ? link({ href: "/admin", label: "Tableau de bord", icon: LayoutDashboard }) : null}
        {groups.map((g) => {
          const expanded = isOpen(g.key);
          const holdsActive = activeGroup === g.key;
          return (
            <div key={g.key} className="mb-0.5">
              <button type="button" onClick={() => setOpenGroup(expanded ? null : g.key)} aria-expanded={expanded} className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-bold transition hover:surface-2 ${holdsActive && !expanded ? "text-lagon-600 dark:text-lagon-300" : "text-[var(--text)]"}`}>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg surface-2"><g.icon className="h-4 w-4" /></span>{g.label}
                <ChevronDown className={`ml-auto h-4 w-4 text-muted transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>
              {expanded ? <div className="mb-1 ml-3 border-l border-line pl-1">{g.items.map((n) => link(n, true))}</div> : null}
            </div>
          );
        })}
        {me?.platformAdmin ? <div className="mt-2 border-t border-line pt-2">{link({ href: "/platform", label: "Console ManaResto", icon: ShieldCheck })}</div> : null}
      </nav>
      <div className="border-t border-line p-2">
        <InstallAppButton variant="secondary" className="mb-2 h-10 w-full justify-start" label="Installer l'application" compact />
        {/* Téléphone et tablette : les portails sont déjà dans la barre du bas */}
        <div className="hidden lg:block"><PortalButtons onNavigate={() => setOpen(false)} /></div>
        <div className="mt-2 flex items-center gap-2 px-1">
          <span className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: me?.user?.color ?? "#0ea5a4" }}>{(me?.user?.firstName ?? "?").slice(0, 1)}</span>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{me?.user?.firstName} {me?.user?.lastName}<span className="block text-xs font-normal text-muted">{me?.roleKey}</span></span>
          <button onClick={toggle} className="touch rounded-lg p-2 hover:surface-2"><Sun className="h-4 w-4 dark:hidden" /><Moon className="hidden h-4 w-4 dark:block" /></button>
          <button onClick={logout} className="touch rounded-lg p-2 hover:surface-2" title="Déconnexion"><LogOut className="h-4 w-4" /></button>
        </div>
        <p className="mt-1 px-1 text-[10px] text-muted" title="Version installée">ManaResto · version {BUILD_ID}</p>
      </div>
    </aside>
  );

  return (
    <div className="flex h-dvh">
      <div className="hidden lg:block">{Sidebar}</div>
      {open ? <div className="fixed inset-0 z-40 flex lg:hidden"><div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} /><div className="relative z-10" style={{ paddingTop: "env(safe-area-inset-top)" }}>{Sidebar}</div></div> : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <SupportBar />
        <DemoVisitBar />
        <header className="glass flex h-14 shrink-0 items-center gap-3 border-b px-4 lg:hidden"><button className="touch flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white shadow-glow active:scale-95" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button><Logo size={28} /><VersionBadge /></header>
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 lg:p-8"><InstallBanner className="mb-3 lg:hidden" /><SubscriptionBanner />{children}</main>
        {/* Téléphone / tablette : les portails Salle, Caisse et Cuisine, toujours à portée de pouce */}
        <PortalButtons variant="dock" className="lg:hidden" />
      </div>
    </div>
  );
}
