"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { addDays, formatTime, localDay } from "@/lib/dates";
import { PageHeader, useAction, useList } from "@/components/admin/common";
import { StaffTabs } from "@/components/admin/staff-tabs";
import { fmtHours, fromLocalInput, toLocalInput, type Employee, type Shift } from "@/components/admin/staff-types";

const DAY_LABEL = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
function mondayOf(day: string) { const d = new Date(day + "T12:00:00"); const wd = (d.getDay() + 6) % 7; return addDays(day, -wd); }

/** Planning hebdomadaire : un service = employé + début + fin. */
export default function ShiftsPage() {
  const { timezone } = useSession();
  const act = useAction();
  const [monday, setMonday] = useState(() => mondayOf(localDay(new Date())));
  const sunday = addDays(monday, 6);
  const shifts = useList<Shift[]>(["staff", "shifts", monday], `/api/staff/shifts?from=${monday}&to=${sunday}`);
  const employees = useList<Employee[]>(["staff", "employees"], "/api/staff/employees");
  const [edit, setEdit] = useState<{ id?: string; employeeId: string; startsAt: string; endsAt: string; notes: string } | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const dayOf = (s: Shift) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s.startsAt));
  const save = async () => {
    if (!edit) return;
    const body = { employeeId: edit.employeeId, startsAt: fromLocalInput(edit.startsAt), endsAt: fromLocalInput(edit.endsAt), notes: edit.notes || null };
    const r = await act(() => (edit.id ? api.patch(`/api/staff/shifts/${edit.id}`, body) : api.post("/api/staff/shifts", body)), { success: "Service enregistré", invalidate: [["staff"]] });
    if (r) setEdit(null);
  };
  const total = (shifts.data ?? []).reduce((a, s) => a + (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()), 0) / 3600000;
  return (
    <div>
      <PageHeader title="Planning" subtitle={`Semaine du ${monday} au ${sunday} · ${fmtHours(total)} planifiées`} action={<div className="flex items-center gap-2"><Button variant="secondary" size="sm" onClick={() => setMonday(addDays(monday, -7))}>‹</Button><Button variant="secondary" size="sm" onClick={() => setMonday(mondayOf(localDay(new Date())))}>Cette semaine</Button><Button variant="secondary" size="sm" onClick={() => setMonday(addDays(monday, 7))}>›</Button><Button onClick={() => setEdit({ employeeId: employees.data?.[0]?.id ?? "", startsAt: `${monday}T11:00`, endsAt: `${monday}T15:00`, notes: "" })}>Nouveau service</Button></div>} />
      <StaffTabs />
      {shifts.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d) => {
            const list = (shifts.data ?? []).filter((s) => dayOf(s) === d);
            const isToday = d === localDay(new Date(), timezone);
            return (
              <div key={d} className={`card min-h-[140px] p-2 ${isToday ? "ring-2 ring-lagon-500/40" : ""}`}>
                <p className="mb-1 flex items-center justify-between text-xs font-bold uppercase text-muted"><span>{DAY_LABEL[new Date(d + "T12:00:00").getDay()]} {d.slice(8)}</span><button onClick={() => setEdit({ employeeId: employees.data?.[0]?.id ?? "", startsAt: `${d}T11:00`, endsAt: `${d}T15:00`, notes: "" })} className="text-lagon-600">+</button></p>
                {list.map((s) => <button key={s.id} onClick={() => setEdit({ id: s.id, employeeId: s.employeeId, startsAt: toLocalInput(s.startsAt), endsAt: toLocalInput(s.endsAt), notes: s.notes ?? "" })} className="touch mb-1 block w-full rounded-lg bg-lagon-500/10 px-2 py-1 text-left text-xs hover:bg-lagon-500/20"><span className="font-bold">{s.employee.firstName}</span><span className="block text-muted">{formatTime(s.startsAt, timezone)} – {formatTime(s.endsAt, timezone)}{s.notes ? ` · ${s.notes}` : ""}</span></button>)}
              </div>
            );
          })}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier le service" : "Nouveau service"} size="sm" footer={<div className="flex gap-2">{edit?.id ? <Button variant="danger" onClick={() => act(() => api.delete(`/api/staff/shifts/${edit.id}`), { success: "Supprimé", invalidate: [["staff"]] }).then(() => setEdit(null))}>Supprimer</Button> : null}<Button className="flex-1" disabled={!edit?.employeeId} onClick={save}>Enregistrer</Button></div>}>
        {edit ? <div className="space-y-3">
          <Field label="Employé"><Select value={edit.employeeId} onChange={(e) => setEdit({ ...edit, employeeId: e.target.value })}>{employees.data?.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}{e.jobTitle ? ` · ${e.jobTitle}` : ""}</option>)}</Select></Field>
          <Field label="Début"><Input type="datetime-local" value={edit.startsAt} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} /></Field>
          <Field label="Fin"><Input type="datetime-local" value={edit.endsAt} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} /></Field>
          <Field label="Note"><Input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="Service du midi, terrasse…" /></Field>
        </div> : null}
      </Modal>
    </div>
  );
}
