"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, UtensilsCrossed, Map, Receipt, Wallet, Users, Settings, ScrollText, Building2, Moon, Sun, LogOut, Menu, X, MonitorSmartphone, ChefHat, Boxes, CalendarDays, Heart, QrCode, BarChart3, Clock, Plug, Network, TrendingUp } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { useRealtime } from "@/hooks/use-realtime";
import { useTheme } from "@/hooks/use-theme";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { BUILD_ID } from "@/lib/build";
import { api } from "@/lib/api-client";
import { Logo } from "@/components/brand";
import { Spinner } from "@/components/ui/misc";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const { me, can, isLoading } = useSession();
  const { toggle } = useTheme();
  const [open, setOpen] = useState(false);
  useRealtime(!!me?.user);
  const { canInstall, install } = useInstallPrompt();

  if (isLoading) return <div className="flex h-screen items-center justify-center"><Spinner /></div>;

  const nav = [
    { href: "/admin", label: "Tableau de bord", icon: LayoutDashboard, show: can("reports.view") },
    { href: "/admin/catalog/products", label: "Catalogue", icon: UtensilsCrossed, show: can("catalog.view"), match: "/admin/catalog" },
    { href: "/admin/floor", label: "Plan de salle", icon: Map, show: can("floor.manage") },
    { href: "/admin/orders", label: "Commandes", icon: Receipt, show: can("orders.view_history") },
    { href: "/admin/cash", label: "Caisse", icon: Wallet, show: can("reports.view") },
    { href: "/admin/stats", label: "Statistiques", icon: TrendingUp, show: can("reports.view") },
    { href: "/admin/reports", label: "Rapports & exports", icon: BarChart3, show: can("reports.view") },
    { href: "/admin/users", label: "Utilisateurs", icon: Users, show: can("users.manage") },
    { href: "/admin/settings", label: "Paramètres", icon: Settings, show: can("settings.manage") },
    { href: "/admin/audit", label: "Journal d'audit", icon: ScrollText, show: can("audit.view") },
    { href: "/kds", label: "Écran cuisine", icon: ChefHat, show: can("kds.use") },
    { href: "/admin/stock", label: "Stocks & achats", icon: Boxes, show: can("stock.view"), match: "/admin/stock" },
    { href: "/admin/staff", label: "Personnel", icon: Clock, show: can("staff.manage"), match: "/admin/staff" },
    { href: "/admin/customers", label: "Clients & fidélité", icon: Heart, show: can("customers.manage") },
    { href: "/pos/reservations", label: "Réservations", icon: CalendarDays, show: can("pos.use") },
    { href: "/admin/digital", label: "Digital : QR, en ligne, borne", icon: QrCode, show: can("settings.manage") },
    { href: "/admin/establishments", label: "Établissements", icon: Building2, show: can("establishments.manage") || (me?.establishments?.length ?? 0) > 1 },
    { href: "/admin/organization", label: "Multi-sites", icon: Network, show: can("reports.view_global") },
    { href: "/admin/integrations", label: "Intégrations : API, webhooks, imprimantes, TPE", icon: Plug, show: can("settings.manage") },
  ].filter((n) => n.show);

  const switchEst = async (id: string) => { await api.post("/api/auth/switch-establishment", { establishmentId: id }); qc.clear(); router.refresh(); qc.invalidateQueries(); };
  const logout = async () => { await api.post("/api/auth/logout"); qc.clear(); router.replace("/login"); };

  const Sidebar = (
    <aside className="flex h-full w-[268px] flex-col border-r border-line surface">
      <div className="flex h-16 items-center justify-between px-5"><Logo size={34} /><button className="touch rounded-lg p-2 lg:hidden" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button></div>
      {me?.establishments && me.establishments.length > 1 ? (
        <select value={me.establishment?.id ?? ""} onChange={(e) => switchEst(e.target.value)} className="mx-3 mb-2 h-10 rounded-lg border border-line surface-2 px-2 text-sm font-semibold">
          {me.establishments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      ) : <p className="mx-4 mb-2 truncate text-sm font-semibold text-muted">{me?.establishment?.name}</p>}
      <nav className="flex-1 overflow-y-auto px-2">
        {nav.map((n) => {
          const active = n.match ? pathname.startsWith(n.match) : pathname === n.href;
          return <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={`mb-1 flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${active ? "bg-brand text-white shadow-glow" : "text-muted hover:surface-2 hover:text-[var(--text)]"}`}><span className={`flex h-7 w-7 items-center justify-center rounded-lg ${active ? "bg-white/15" : "surface-2"}`}><n.icon className="h-4 w-4" /></span>{n.label}</Link>;
        })}
      </nav>
      <div className="border-t border-line p-2">
        {canInstall ? <button onClick={install} className="mb-1 flex h-10 w-full items-center gap-3 rounded-lg surface-2 px-3 text-sm font-semibold"><MonitorSmartphone className="h-4 w-4" />Installer l&apos;application</button> : null}
        <Link href="/pos" className="bg-accent flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-bold text-white shadow-[0_8px_24px_-8px_rgb(249_124_60/0.5)]"><MonitorSmartphone className="h-4 w-4" />Ouvrir la caisse</Link>
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
        <header className="glass flex h-14 shrink-0 items-center gap-3 border-b px-4 lg:hidden"><button className="touch rounded-lg p-2" onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button><Logo size={28} /></header>
        <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 pb-28 lg:p-8">{children}</main>
        {/* Téléphone / tablette : gros bouton d'accès à la caisse, toujours visible */}
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center p-3 lg:hidden" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <Link href="/pos" className="bg-accent pointer-events-auto flex h-14 w-full max-w-md items-center justify-center gap-3 rounded-2xl text-base font-extrabold text-white shadow-[0_12px_32px_-8px_rgb(249_124_60/0.6)] ring-1 ring-white/20 transition active:scale-[0.98]"><MonitorSmartphone className="h-5 w-5" />Ouvrir la caisse</Link>
        </div>
      </div>
    </div>
  );
}
