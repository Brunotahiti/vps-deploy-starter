"use client";

import { useSession } from "@/hooks/use-session";
import { formatDateTime } from "@/lib/dates";
import { Spinner, Badge } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { PageHeader, Table, Tr, Td, useList } from "@/components/admin/common";
import type { CashSession } from "@/generated/prisma/client";

type Row = CashSession & { openedBy: { firstName: string; lastName: string; displayName: string | null }; closedBy: { firstName: string; lastName: string; displayName: string | null } | null; terminal: { name: string } | null };

export default function CashAdmin() {
  const { timezone } = useSession();
  const q = useList<Row[]>(["cash", "sessions"], "/api/cash");
  const n = (u: Row["openedBy"] | null) => (u ? u.displayName || u.firstName : "—");
  return (
    <div>
      <PageHeader title="Sessions de caisse" subtitle="Ouvertures, clôtures et écarts (rapports X / Z)" />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Ouverture", "Clôture", "Par", "Terminal", "Fond", "Théorique", "Compté", "Écart", "Statut", ""]}>
          {q.data?.map((s) => (
            <Tr key={s.id}>
              <Td>{formatDateTime(s.openedAt, timezone)}</Td><Td>{s.closedAt ? formatDateTime(s.closedAt, timezone) : "—"}</Td><Td>{n(s.openedBy)}{s.closedBy ? ` / ${n(s.closedBy)}` : ""}</Td><Td>{s.terminal?.name ?? "—"}</Td>
              <Td><Money amount={s.openingFloat} /></Td><Td>{s.expectedCash !== null ? <Money amount={s.expectedCash} /> : "—"}</Td><Td>{s.countedCash !== null ? <Money amount={s.countedCash} /> : "—"}</Td>
              <Td className={s.difference ? (s.difference < 0 ? "font-bold text-red-600" : "font-bold text-orange-500") : ""}>{s.difference !== null ? <Money amount={s.difference} /> : "—"}</Td>
              <Td><Badge color={s.status === "OPEN" ? "green" : "gray"}>{s.status === "OPEN" ? "Ouverte" : "Clôturée"}</Badge></Td>
              <Td><a href={`/api/cash/${s.id}/report`} target="_blank" rel="noreferrer" className="font-semibold text-lagon-600">Rapport {s.status === "OPEN" ? "X" : "Z"}</a></Td>
            </Tr>
          ))}
        </Table>
      )}
    </div>
  );
}
