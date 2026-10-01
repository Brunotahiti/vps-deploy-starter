"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { addDays, formatDateTime, localDay } from "@/lib/dates";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { StaffTabs } from "@/components/admin/staff-tabs";
import { CLOCK_LABEL, fromLocalInput, toLocalInput, type Employee, type TimeEntry } from "@/components/admin/staff-types";

/** Pointages bruts avec correction manager (heure, type) et ajout manuel, toujours motivés. */
export default function EntriesPage() {
  const { timezone } = useSession();
  const act = useAction();
  const today = localDay(new Date(), timezone);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [employeeId, setEmployeeId] = useState("");
  const entries = useList<TimeEntry[]>(["staff", "entries", from, to, employeeId], `/api/staff/entries?from=${from}&to=${to}${employeeId ? `&employeeId=${employeeId}` : ""}`);
  const employees = useList<Employee[]>(["staff", "employees"], "/api/staff/employees");
  const [edit, setEdit] = useState<{ id?: string; employeeId: string; kind: string; at: string; reason: string } | null>(null);
  const save = async () => {
    if (!edit) return;
    const body = { employeeId: edit.employeeId, kind: edit.kind, at: fromLocalInput(edit.at, timezone), reason: edit.reason };
    const r = await act(() => (edit.id ? api.patch(`/api/staff/entries/${edit.id}`, body) : api.post("/api/staff/entries", body)), { success: "Pointage enregistré", invalidate: [["staff"]] });
    if (r) setEdit(null);
  };
  const color = (k: string) => (k === "CLOCK_IN" ? "green" : k === "CLOCK_OUT" ? "red" : "orange") as "green" | "red" | "orange";
  return (
    <div>
      <PageHeader title="Pointages" subtitle="Arrivées, pauses, reprises et départs ; corrections tracées dans le journal d'audit" action={<Button onClick={() => setEdit({ employeeId: employees.data?.[0]?.id ?? "", kind: "CLOCK_IN", at: toLocalInput(new Date(), timezone), reason: "" })}>Pointage manuel</Button>} />
      <StaffTabs />
      <div className="mb-3 flex flex-wrap items-center gap-2"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40!" /><span>→</span><Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="w-40!" /><Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="w-56!"><option value="">Tous les employés</option>{employees.data?.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</Select></div>
      {entries.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Date et heure", "Employé", "Type", ""]}>
          {entries.data?.map((e) => <Tr key={e.id}><Td className="whitespace-nowrap">{formatDateTime(e.at, timezone)}</Td><Td className="font-semibold">{e.employee.firstName} {e.employee.lastName}</Td><Td><Badge color={color(e.kind)}>{CLOCK_LABEL[e.kind]}</Badge></Td><Td className="space-x-3 whitespace-nowrap"><button onClick={() => setEdit({ id: e.id, employeeId: e.employeeId, kind: e.kind, at: toLocalInput(e.at, timezone), reason: "" })} className="text-xs font-semibold text-lagon-600">Corriger</button><button onClick={() => { const reason = prompt("Motif de la suppression ?"); if (reason) act(() => api.delete(`/api/staff/entries/${e.id}?reason=${encodeURIComponent(reason)}`), { success: "Supprimé", invalidate: [["staff"]] }); }} className="text-xs font-semibold text-red-600">Supprimer</button></Td></Tr>)}
          {entries.data?.length === 0 ? <Tr><Td className="py-8 text-center text-muted">Aucun pointage sur la période</Td></Tr> : null}
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Corriger le pointage" : "Pointage manuel"} size="sm" footer={<Button className="w-full" disabled={!edit?.reason || !edit.employeeId} onClick={save}>Enregistrer</Button>}>
        {edit ? <div className="space-y-3">
          <Field label="Employé"><Select value={edit.employeeId} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, employeeId: e.target.value })}>{employees.data?.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</Select></Field>
          <Field label="Type"><Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{Object.entries(CLOCK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Date et heure"><Input type="datetime-local" value={edit.at} onChange={(e) => setEdit({ ...edit, at: e.target.value })} /></Field>
          <Field label="Motif (obligatoire)"><Input value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} placeholder="Oubli de pointage, erreur d'heure…" /></Field>
        </div> : null}
      </Modal>
    </div>
  );
}
