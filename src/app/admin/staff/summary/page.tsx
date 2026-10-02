"use client";

import { useState } from "react";
import { useSession } from "@/hooks/use-session";
import { Input } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { addDays, localDay } from "@/lib/dates";
import { PageHeader, Table, Tr, Td, useList } from "@/components/admin/common";
import { Stat } from "@/components/admin/charts";
import { StaffTabs } from "@/components/admin/staff-tabs";
import { fmtHours, type StaffSummary } from "@/components/admin/staff-types";

/** Heures travaillées, écart au planning, coût du personnel et ratio sur le CA HT. */
export default function StaffSummaryPage() {
  const { timezone, hasOption } = useSession();
  const today = localDay(new Date(), timezone);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const s = useList<StaffSummary>(["staff", "summary", from, to], `/api/staff/summary?from=${from}&to=${to}`);
  const d = s.data;
  const exportUrl = (format: string) => `/api/reports/export?type=staff&format=${format}&from=${from}&to=${to}`;
  return (
    <div>
      <PageHeader title="Heures & coût du personnel" subtitle="Calculé à partir des pointages et du coût horaire de chaque employé" action={<div className="flex flex-wrap items-center gap-2"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40!" /><span>→</span><Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="w-40!" />{hasOption("stats") ? <><a href={exportUrl("xlsx")} className="touch rounded-xl border border-line px-3 py-2 text-sm font-semibold">Excel</a><a href={exportUrl("csv")} className="touch rounded-xl border border-line px-3 py-2 text-sm font-semibold">CSV</a><a href={exportUrl("pdf")} target="_blank" rel="noreferrer" className="touch rounded-xl border border-line px-3 py-2 text-sm font-semibold">PDF</a></> : null}</div>} />
      <StaffTabs />
      {s.isLoading || !d ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Heures travaillées" value={fmtHours(d.totalHours)} hint={`planifiées ${fmtHours(d.totalPlannedHours)}`} />
            <Stat label="Coût du personnel" value={<Money amount={d.totalCost} />} accent="#8b5cf6" />
            <Stat label="CA HT" value={<Money amount={d.revenueHt} />} accent="#3b82f6" />
            <Stat label="Coût personnel / CA" value={d.laborCostPct !== null ? `${d.laborCostPct} %` : "—"} accent={d.laborCostPct !== null && d.laborCostPct > 35 ? "#ef4444" : "#22c55e"} />
            <Stat label="CA HT par heure" value={d.revenuePerHour !== null ? <Money amount={d.revenuePerHour} /> : "—"} accent="#f97c3c" />
          </div>
          <Table head={["Employé", "Poste", "Travaillé", "Pauses", "Planifié", "Écart", "Coût horaire", "Coût"]}>
            {d.rows.map((r) => <Tr key={r.id}><Td className="font-semibold">{r.firstName} {r.lastName}{r.open ? <Badge color="green">en service</Badge> : null}</Td><Td>{r.jobTitle ?? "—"}</Td><Td className="font-semibold tabular-nums">{fmtHours(r.hours)}</Td><Td className="tabular-nums text-muted">{fmtHours(r.breakHours)}</Td><Td className="tabular-nums">{fmtHours(r.plannedHours)}</Td><Td className={`tabular-nums font-semibold ${r.variance > 0.25 ? "text-orange-600" : r.variance < -0.25 ? "text-blue-600" : ""}`}>{r.variance > 0 ? "+" : ""}{fmtHours(Math.abs(r.variance)).replace(/^/, r.variance < 0 ? "−" : "")}</Td><Td>{r.hourlyCost !== null ? <Money amount={r.hourlyCost} /> : "—"}</Td><Td className="font-semibold"><Money amount={r.cost} /></Td></Tr>)}
            <Tr><Td className="font-extrabold">Total</Td><Td /><Td className="font-extrabold tabular-nums">{fmtHours(d.totalHours)}</Td><Td /><Td className="tabular-nums">{fmtHours(d.totalPlannedHours)}</Td><Td /><Td /><Td className="font-extrabold"><Money amount={d.totalCost} /></Td></Tr>
          </Table>
        </div>
      )}
    </div>
  );
}
