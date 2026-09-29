"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { formatDateTime } from "@/lib/dates";
import { Spinner } from "@/components/ui/misc";
import { PageHeader, Table, Tr, Td } from "@/components/admin/common";
import type { AuditLog } from "@/generated/prisma/client";

type Row = AuditLog & { user: { firstName: string; lastName: string; displayName: string | null } | null; terminal: { name: string } | null };

export default function AuditPage() {
  const { timezone } = useSession();
  const [action, setAction] = useState("");
  const [skip, setSkip] = useState(0);
  const q = useQuery({ queryKey: ["audit", action, skip], queryFn: () => api.get<{ items: Row[]; total: number }>(`/api/audit?take=50&skip=${skip}${action ? `&action=${action}` : ""}`) });
  const json = (v: unknown) => (v === null || v === undefined ? "" : JSON.stringify(v));
  return (
    <div>
      <PageHeader title="Journal d'audit" subtitle="Opérations sensibles, en lecture seule. Non modifiable depuis l'application." action={
        <select value={action} onChange={(e) => { setAction(e.target.value); setSkip(0); }} className="h-10 rounded-lg border border-line surface px-2 text-sm">
          <option value="">Toutes les actions</option>{["order.", "item.", "payment.", "cash.", "product.", "user.", "taxrate.", "establishment.", "terminal."].map((a) => <option key={a} value={a}>{a}*</option>)}
        </select>
      } />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <>
          <Table head={["Date", "Utilisateur", "Terminal", "Action", "Entité", "Ancienne valeur", "Nouvelle valeur", "Motif"]}>
            {q.data?.items.map((l) => (
              <Tr key={l.id}>
                <Td className="whitespace-nowrap">{formatDateTime(l.createdAt, timezone)}</Td><Td>{l.user ? l.user.displayName || l.user.firstName : "—"}{l.authorizedById ? <span className="ml-1 rounded bg-purple-500/15 px-1 text-[10px] font-bold text-purple-600">PIN manager</span> : null}</Td><Td>{l.terminal?.name ?? "—"}</Td>
                <Td className="font-mono text-xs font-semibold">{l.action}</Td><Td className="font-mono text-xs">{l.entityType}</Td>
                <Td className="max-w-[200px] truncate font-mono text-[11px] text-muted" title={json(l.oldValue)}>{json(l.oldValue)}</Td><Td className="max-w-[200px] truncate font-mono text-[11px]" title={json(l.newValue)}>{json(l.newValue)}</Td><Td>{l.reason ?? ""}</Td>
              </Tr>
            ))}
          </Table>
          <div className="mt-3 flex items-center justify-between text-sm text-muted"><span>{q.data?.total ?? 0} entrées</span><div className="flex gap-2"><button disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - 50))} className="rounded-lg surface-2 px-3 py-1.5 font-semibold disabled:opacity-40">Précédent</button><button disabled={(q.data?.total ?? 0) <= skip + 50} onClick={() => setSkip(skip + 50)} className="rounded-lg surface-2 px-3 py-1.5 font-semibold disabled:opacity-40">Suivant</button></div></div>
        </>
      )}
    </div>
  );
}
