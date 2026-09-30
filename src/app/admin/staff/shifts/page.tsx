"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Clock } from "lucide-react";
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

const PALETTE = ["#14aaa3", "#f97c3c", "#4a3aa7", "#eda100", "#e87ba4", "#2a78d6", "#0ca30c", "#e34948"];
function mondayOf(day: string) { const d = new Date(day + "T12:00:00"); const wd = (d.getDay() + 6) % 7; return addDays(day, -wd); }
const fmtDay = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(day + "T12:00:00").toLocaleDateString("fr-FR", opts);
const hours = (s: Shift) => (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 3600000;

/** Planning hebdomadaire : un service = employé + début + fin. Lecture rapide par jour, couleur par employé. */
export default function ShiftsPage() {
  const { timezone } = useSession();
  const act = useAction();
  const today = localDay(new Date(), timezone);
  const [monday, setMonday] = useState(() => mondayOf(today));
  const sunday = addDays(monday, 6);
  const shifts = useList<Shift[]>(["staff", "shifts", monday], `/api/staff/shifts?from=${monday}&to=${sunday}`);
  const employees = useList<Employee[]>(["staff", "employees"], "/api/staff/employees");
  const [edit, setEdit] = useState<{ id?: string; employeeId: string; startsAt: string; endsAt: string; notes: string } | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const dayOf = (s: Shift) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s.startsAt));
  const colorOf = (employeeId: string) => PALETTE[Math.max(0, (employees.data ?? []).findIndex((e) => e.id === employeeId)) % PALETTE.length];
  const newShift = (d: string) => setEdit({ employeeId: employees.data?.[0]?.id ?? "", startsAt: `${d}T11:00`, endsAt: `${d}T15:00`, notes: "" });
  const save = async () => {
    if (!edit) return;
    const body = { employeeId: edit.employeeId, startsAt: fromLocalInput(edit.startsAt, timezone), endsAt: fromLocalInput(edit.endsAt, timezone), notes: edit.notes || null };
    const r = await act(() => (edit.id ? api.patch(`/api/staff/shifts/${edit.id}`, body) : api.post("/api/staff/shifts", body)), { success: "Service enregistré", invalidate: [["staff"]] });
    if (r) setEdit(null);
  };
  const all = shifts.data ?? [];
  const total = all.reduce((a, s) => a + hours(s), 0);
  const byEmployee = Object.values(all.reduce<Record<string, { name: string; id: string; h: number; n: number }>>((acc, s) => { const k = s.employeeId; acc[k] = acc[k] ?? { id: k, name: `${s.employee.firstName} ${s.employee.lastName}`, h: 0, n: 0 }; acc[k].h += hours(s); acc[k].n++; return acc; }, {})).sort((a, b) => b.h - a.h);
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  const weekLabel = `${fmtDay(monday, { day: "numeric", ...(sameMonth ? {} : { month: "short" }) })} → ${fmtDay(sunday, { day: "numeric", month: "long" })}`;
  const isCurrentWeek = monday === mondayOf(today);

  return (
    <div>
      <PageHeader title="Planning" subtitle={`Semaine du ${weekLabel} · ${fmtHours(total)} planifiées · ${all.length} service${all.length > 1 ? "s" : ""}`} action={
        <div className="flex items-center gap-1.5">
          <button onClick={() => setMonday(addDays(monday, -7))} className="touch flex h-10 w-10 items-center justify-center rounded-xl surface-2" aria-label="Semaine précédente"><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={() => setMonday(mondayOf(today))} disabled={isCurrentWeek} className="touch h-10 rounded-xl surface-2 px-3 text-sm font-semibold disabled:opacity-50"><CalendarDays className="mr-1.5 inline h-4 w-4" />Cette semaine</button>
          <button onClick={() => setMonday(addDays(monday, 7))} className="touch flex h-10 w-10 items-center justify-center rounded-xl surface-2" aria-label="Semaine suivante"><ChevronRight className="h-4 w-4" /></button>
          <Button onClick={() => newShift(isCurrentWeek ? today : monday)}><Plus className="h-4 w-4" /> Service</Button>
        </div>
      } />
      <StaffTabs />
      {shifts.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <div className="space-y-4">
          <div className="grid gap-2 md:grid-cols-7">
            {days.map((d) => {
              const list = all.filter((s) => dayOf(s) === d);
              const isToday = d === today;
              const dayHours = list.reduce((a, s) => a + hours(s), 0);
              return (
                <section key={d} className={`card p-2.5 md:min-h-[180px] ${isToday ? "ring-2 ring-lagon-500/40" : ""}`}>
                  <header className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-baseline gap-1.5"><span className={`text-xs font-extrabold uppercase ${isToday ? "text-lagon-600" : ""}`}>{fmtDay(d, { weekday: "short" }).replace(".", "")}</span><span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold ${isToday ? "bg-brand text-white" : ""}`}>{Number(d.slice(8))}</span>{dayHours ? <span className="text-[11px] text-muted">{fmtHours(dayHours)}</span> : null}</div>
                    <button onClick={() => newShift(d)} className="touch flex h-8 w-8 items-center justify-center rounded-lg text-lagon-600 hover:surface-2" aria-label={`Ajouter un service le ${d}`}><Plus className="h-4 w-4" /></button>
                  </header>
                  {list.length === 0 ? <button onClick={() => newShift(d)} className="touch flex h-10 w-full items-center justify-center rounded-xl border border-dashed border-line text-xs font-semibold text-muted hover:surface-2 md:h-14">Aucun service · ajouter</button> : (
                    <ul className="space-y-1.5">
                      {list.map((s) => { const c = colorOf(s.employeeId); return (
                        <li key={s.id}>
                          <button onClick={() => setEdit({ id: s.id, employeeId: s.employeeId, startsAt: toLocalInput(s.startsAt, timezone), endsAt: toLocalInput(s.endsAt, timezone), notes: s.notes ?? "" })} className="touch flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition hover:brightness-95" style={{ background: `color-mix(in srgb, ${c} 12%, transparent)`, borderLeft: `3px solid ${c}` }}>
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white" style={{ background: c }}>{s.employee.firstName.slice(0, 1)}{s.employee.lastName.slice(0, 1)}</span>
                            <span className="min-w-0 flex-1"><span className="block truncate font-bold">{s.employee.firstName} {s.employee.lastName.slice(0, 1)}.</span><span className="block text-muted"><Clock className="mr-1 inline h-3 w-3" />{formatTime(s.startsAt, timezone)} – {formatTime(s.endsAt, timezone)} · {fmtHours(hours(s))}{s.notes ? ` · ${s.notes}` : ""}</span></span>
                          </button>
                        </li>
                      ); })}
                    </ul>
                  )}
                </section>
              );
            })}
          </div>
          {byEmployee.length ? (
            <section className="card p-4">
              <h3 className="mb-2 text-sm font-extrabold">Heures par employé cette semaine</h3>
              <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {byEmployee.map((e) => { const c = colorOf(e.id); const w = (e.h / Math.max(1, byEmployee[0].h)) * 100; return (
                  <li key={e.id} className="text-xs"><div className="mb-1 flex items-center justify-between"><span className="flex items-center gap-2 font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />{e.name}<span className="font-normal text-muted">· {e.n} service{e.n > 1 ? "s" : ""}</span></span><span className="font-bold tabular-nums">{fmtHours(e.h)}</span></div><div className="h-1.5 rounded-full" style={{ background: "var(--viz-grid)" }}><div className="h-1.5 rounded-full" style={{ width: `${w}%`, background: c }} /></div></li>
                ); })}
              </ul>
            </section>
          ) : null}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier le service" : "Nouveau service"} size="sm" footer={<div className="flex gap-2">{edit?.id ? <Button variant="danger" onClick={() => act(() => api.delete(`/api/staff/shifts/${edit.id}`), { success: "Supprimé", invalidate: [["staff"]] }).then(() => setEdit(null))}>Supprimer</Button> : null}<Button className="flex-1" disabled={!edit?.employeeId || !edit.startsAt || !edit.endsAt} onClick={save}>Enregistrer</Button></div>}>
        {edit ? <div className="space-y-3">
          <Field label="Employé"><Select value={edit.employeeId} onChange={(e) => setEdit({ ...edit, employeeId: e.target.value })}>{employees.data?.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}{e.jobTitle ? ` · ${e.jobTitle}` : ""}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Début"><Input type="datetime-local" value={edit.startsAt} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} /></Field><Field label="Fin"><Input type="datetime-local" value={edit.endsAt} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} /></Field></div>
          <Field label="Note"><Input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="Service du midi, terrasse…" /></Field>
        </div> : null}
      </Modal>
    </div>
  );
}
