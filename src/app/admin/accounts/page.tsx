"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BookUser, ChevronRight, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { PageHeader } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Badge, Empty, Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { AccountForm, type AccountRow } from "@/components/admin/accounts";

/** Comptes clients pro (option) : encours, à facturer, retards. */
export default function AccountsPage() {
  const { can, hasOption } = useSession();
  const allowed = hasOption("accounts") && can("accounts.manage");
  const q = useQuery({ queryKey: ["accounts", "list"], queryFn: () => api.get<AccountRow[]>("/api/accounts"), enabled: allowed });
  const [creating, setCreating] = useState(false);
  if (!allowed) return <Empty title="Comptes clients & factures pro" hint="Cette option se débloque dans Gestion → Options." />;
  const list = q.data ?? [];
  const totals = { balance: list.reduce((s, a) => s + a.balance, 0), uninvoiced: list.reduce((s, a) => s + a.uninvoiced, 0), overdue: list.reduce((s, a) => s + a.overdue, 0) };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Comptes clients" subtitle="Entreprises, administrations et habitués à qui vous faites crédit : consommations sur compte, factures, règlements."
        action={<Button onClick={() => setCreating(true)} data-testid="account-new"><Plus className="h-4 w-4" />Nouveau compte</Button>} />
      {q.isLoading ? <Spinner /> : !list.length ? (
        <Empty title="Aucun compte client" hint="Créez un compte, puis à la caisse choisissez « Sur compte » au moment d'encaisser." action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Créer un compte</Button>} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <div className="card p-4"><p className="text-xs uppercase text-muted">Encours total</p><p className="text-xl font-extrabold"><Money amount={totals.balance} /></p></div>
            <div className="card p-4"><p className="text-xs uppercase text-muted">À facturer</p><p className="text-xl font-extrabold"><Money amount={totals.uninvoiced} /></p></div>
            <div className={`card p-4 ${totals.overdue ? "ring-2 ring-red-400/50" : ""}`}><p className="text-xs uppercase text-muted">En retard</p><p className={`text-xl font-extrabold ${totals.overdue ? "text-red-600" : ""}`}><Money amount={totals.overdue} /></p></div>
          </div>
          <ul className="card divide-y divide-[var(--border)]">
            {list.map((a) => (
              <li key={a.id}>
                <Link href={`/admin/accounts/${a.id}`} className={`flex items-center gap-3 px-4 py-3 hover:surface-2 ${a.isActive ? "" : "opacity-60"}`} data-testid="account-row">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-500 to-slate-800 text-white"><BookUser className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{a.name}{!a.isActive ? <span className="ml-2"><Badge>Fermé</Badge></span> : null}</p>
                    <p className="truncate text-xs text-muted">{[a.contactName, a.tahitiNumber ? `N° Tahiti ${a.tahitiNumber}` : null].filter(Boolean).join(" · ") || "—"}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-extrabold"><Money amount={a.balance} /></p>
                    <p className="text-xs text-muted">{a.uninvoiced ? <>à facturer <Money amount={a.uninvoiced} /></> : a.creditLimit !== null ? <>plafond <Money amount={a.creditLimit} /></> : "sans plafond"}</p>
                    {a.overdue ? <p className="flex items-center justify-end gap-1 text-xs font-bold text-red-600"><AlertTriangle className="h-3 w-3" />retard <Money amount={a.overdue} /></p> : null}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {creating ? <AccountForm onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
