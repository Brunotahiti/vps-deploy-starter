"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, CalendarDays, Clock, Repeat, Palmtree, UserRoundCheck, CopyCheck, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { addDays, formatTime, localDay } from "@/lib/dates";
import { PageHeader, useAction, useList } from "@/components/admin/common";
import { StaffTabs } from "@/components/admin/staff-tabs";
import { fmtHours, fromLocalInput, toLocalInput, type Absence, type Employee, type Shift, type ShiftTemplate } from "@/components/admin/staff-types";

const PALETTE = ["#14aaa3", "#f97c3c", "#4a3aa7", "#eda100", "#e87ba4", "#2a78d6", "#0ca30c", "#e34948"];
const WEEKDAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const ABSENCE_KINDS = { LEAVE: "Congés", SICK: "Maladie", OTHER: "Absence" } as const;
type AbsenceKind = keyof typeof ABSENCE_KINDS;
function mondayOf(day: string) { const d = new Date(day + "T12:00:00"); const wd = (d.getDay() + 6) % 7; return addDays(day, -wd); }
const fmtDay = (day: string, opts: Intl.DateTimeFormatOptions) => new Date(day + "T12:00:00").toLocaleDateString("fr-FR", opts);
const hours = (s: { startsAt: string | Date; endsAt: string | Date }) => (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 3600000;
const templateHours = (t: { startTime: string; endTime: string }) => { const m = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3)); const d = m(t.endTime) - m(t.startTime); return (d <= 0 ? d + 1440 : d) / 60; };
const isoDay = (d: string | Date) => (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
const initials = (e: { firstName: string; lastName: string }) => `${e.firstName.slice(0, 1)}${e.lastName.slice(0, 1)}`;

type ShiftForm = { id?: string; employeeId: string; startsAt: string; endsAt: string; notes: string; absentName?: string; replaces?: string };
type TemplateForm = { id?: string; employeeId: string; weekday: number; startTime: string; endTime: string; notes: string };
type AbsenceForm = { employeeId: string; startsOn: string; endsOn: string; kind: AbsenceKind; notes: string };

/**
 * Planning : la semaine type est saisie une fois et se reporte toute seule chaque semaine.
 * Le gérant ne gère ensuite que les exceptions : congés (services « à remplacer »), remplacements, horaires déplacés.
 */
export default function ShiftsPage() {
  const { timezone } = useSession();
  const act = useAction();
  const today = localDay(new Date(), timezone);
  const [mode, setMode] = useState<"week" | "template">("week");
  const [monday, setMonday] = useState(() => mondayOf(today));
  const sunday = addDays(monday, 6);
  const shifts = useList<Shift[]>(["staff", "shifts", monday], `/api/staff/shifts?from=${monday}&to=${sunday}`);
  const templates = useList<ShiftTemplate[]>(["staff", "templates"], "/api/staff/templates");
  const absences = useList<Absence[]>(["staff", "absences", monday], `/api/staff/absences?from=${monday}&to=${sunday}`);
  const employees = useList<Employee[]>(["staff", "employees"], "/api/staff/employees");
  const [edit, setEdit] = useState<ShiftForm | null>(null);
  const [tpl, setTpl] = useState<TemplateForm | null>(null);
  const [leave, setLeave] = useState<AbsenceForm | null>(null);
  const [leaveList, setLeaveList] = useState(false);
  const [cover, setCover] = useState<number | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const dayOf = (s: Shift) => new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(s.startsAt));
  const colorOf = (employeeId: string) => PALETTE[Math.max(0, (employees.data ?? []).findIndex((e) => e.id === employeeId)) % PALETTE.length];
  const absentOn = (employeeId: string, day: string) => (absences.data ?? []).find((a) => a.employeeId === employeeId && isoDay(a.startsOn) <= day && day <= isoDay(a.endsOn));
  const newShift = (d: string) => setEdit({ employeeId: employees.data?.[0]?.id ?? "", startsAt: `${d}T11:00`, endsAt: `${d}T15:00`, notes: "" });
  const openShift = (s: Shift) => setEdit({ id: s.id, employeeId: s.employeeId, startsAt: toLocalInput(s.startsAt, timezone), endsAt: toLocalInput(s.endsAt, timezone), notes: s.notes ?? "", absentName: s.absence ? `${s.employee.firstName} (${s.absence.label.toLowerCase()})` : undefined, replaces: s.replacesEmployee ? s.replacesEmployee.firstName : undefined });
  const saveShift = async (over: Partial<ShiftForm> = {}) => {
    const f = { ...edit!, ...over };
    const body = { employeeId: f.employeeId, startsAt: fromLocalInput(f.startsAt, timezone), endsAt: fromLocalInput(f.endsAt, timezone), notes: f.notes || null };
    const r = await act(() => (f.id ? api.patch(`/api/staff/shifts/${f.id}`, body) : api.post("/api/staff/shifts", body)), { success: over.employeeId ? "Remplaçant enregistré" : "Service enregistré", invalidate: [["staff"]] });
    if (r) setEdit(null);
  };
  const saveTemplate = async () => {
    if (!tpl) return;
    const body = { employeeId: tpl.employeeId, weekday: tpl.weekday, startTime: tpl.startTime, endTime: tpl.endTime, notes: tpl.notes || null };
    const r = await act(() => (tpl.id ? api.patch(`/api/staff/templates/${tpl.id}`, body) : api.post("/api/staff/templates", body)), { success: "Semaine type mise à jour : les semaines à venir suivent", invalidate: [["staff"]] });
    if (r) setTpl(null);
  };
  const saveLeave = async () => {
    if (!leave) return;
    const r = await act(() => api.post<{ shiftsToCover: number }>("/api/staff/absences", { ...leave, notes: leave.notes || null }), { invalidate: [["staff"]] });
    if (r) {
      setLeave(null);
      setMonday(mondayOf(leave.startsOn));
      setMode("week");
      if (r.shiftsToCover) setCover(r.shiftsToCover);
    }
  };
  const keepWeek = () => confirm("Garder cette semaine comme semaine type ?\n\nElle remplacera la semaine type actuelle et se reportera sur les semaines suivantes (les services que vous avez déjà retouchés ne bougent pas).") && act(() => api.post<{ lines: number }>("/api/staff/templates/from-week", { monday }), { success: "Semaine type enregistrée : elle se reporte toute seule sur les semaines suivantes", invalidate: [["staff"]] });

  const all = shifts.data ?? [];
  const tlist = templates.data ?? [];
  const toCover = all.filter((s) => s.absence);
  const total = all.filter((s) => !s.absence).reduce((a, s) => a + hours(s), 0);
  const byEmployee = Object.values(all.filter((s) => !s.absence).reduce<Record<string, { name: string; id: string; h: number; n: number }>>((acc, s) => { const k = s.employeeId; acc[k] = acc[k] ?? { id: k, name: `${s.employee.firstName} ${s.employee.lastName}`, h: 0, n: 0 }; acc[k].h += hours(s); acc[k].n++; return acc; }, {})).sort((a, b) => b.h - a.h);
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  const weekLabel = `${fmtDay(monday, { day: "numeric", ...(sameMonth ? {} : { month: "short" }) })} → ${fmtDay(sunday, { day: "numeric", month: "long" })}`;
  const isCurrentWeek = monday === mondayOf(today);
  const templateTotal = tlist.reduce((a, t) => a + templateHours(t), 0);
  const empName = (id: string) => { const e = employees.data?.find((x) => x.id === id); return e ? `${e.firstName} ${e.lastName}` : ""; };
  const editDay = edit ? edit.startsAt.slice(0, 10) : "";

  return (
    <div>
      <PageHeader title="Planning" subtitle={mode === "week" ? `Semaine du ${weekLabel} · ${fmtHours(total)} planifiées · ${all.length - toCover.length} service${all.length - toCover.length > 1 ? "s" : ""}${toCover.length ? ` · ${toCover.length} à remplacer` : ""}` : `Semaine type · ${tlist.length} service${tlist.length > 1 ? "s" : ""} · ${fmtHours(templateTotal)} par semaine`} action={
        <div className="flex flex-wrap items-center gap-1.5">
          {mode === "week" ? <>
            <button onClick={() => setMonday(addDays(monday, -7))} className="touch flex h-10 w-10 items-center justify-center rounded-xl surface-2" aria-label="Semaine précédente"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => setMonday(mondayOf(today))} disabled={isCurrentWeek} className="touch h-10 rounded-xl surface-2 px-3 text-sm font-semibold disabled:opacity-50"><CalendarDays className="mr-1.5 inline h-4 w-4" />Cette semaine</button>
            <button onClick={() => setMonday(addDays(monday, 7))} className="touch flex h-10 w-10 items-center justify-center rounded-xl surface-2" aria-label="Semaine suivante"><ChevronRight className="h-4 w-4" /></button>
          </> : null}
          <Button variant="secondary" onClick={() => setLeave({ employeeId: employees.data?.[0]?.id ?? "", startsOn: mode === "week" && !isCurrentWeek ? monday : today, endsOn: mode === "week" && !isCurrentWeek ? monday : today, kind: "LEAVE", notes: "" })} data-testid="add-absence"><Palmtree className="h-4 w-4" /> Congé</Button>
          {mode === "week" ? <Button onClick={() => newShift(isCurrentWeek ? today : monday)}><Plus className="h-4 w-4" /> Service</Button> : <Button onClick={() => setTpl({ employeeId: employees.data?.[0]?.id ?? "", weekday: 0, startTime: "11:00", endTime: "15:00", notes: "" })} data-testid="add-template"><Plus className="h-4 w-4" /> Service type</Button>}
        </div>
      } />
      <StaffTabs />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl surface-2 p-1 text-sm font-semibold" role="tablist">
          <button role="tab" aria-selected={mode === "week"} onClick={() => setMode("week")} className={`touch rounded-lg px-3 py-1.5 ${mode === "week" ? "surface shadow-sm" : "text-muted"}`}>Semaine</button>
          <button role="tab" aria-selected={mode === "template"} onClick={() => setMode("template")} className={`touch rounded-lg px-3 py-1.5 ${mode === "template" ? "surface shadow-sm" : "text-muted"}`} data-testid="template-tab"><Repeat className="mr-1 inline h-3.5 w-3.5" />Semaine type</button>
        </div>
        <button onClick={() => setLeaveList(true)} className="text-sm font-semibold text-lagon-600 hover:underline">Congés et absences</button>
      </div>

      {mode === "week" ? (
        <>
          {!templates.isLoading && tlist.length === 0 ? (
            <div className="card mb-4 flex flex-wrap items-center gap-3 border-l-4 border-lagon-500 p-4 text-sm" data-testid="template-hint">
              <Repeat className="h-5 w-5 shrink-0 text-lagon-600" />
              <p className="min-w-0 flex-1"><b>Saisissez votre planning une seule fois.</b> Remplissez une semaine normale puis gardez-la comme semaine type : elle se reportera toute seule chaque semaine. Vous ne toucherez plus qu&apos;aux congés et aux remplacements.</p>
              {all.length ? <Button size="sm" onClick={keepWeek} data-testid="keep-week"><CopyCheck className="h-4 w-4" /> Garder cette semaine comme semaine type</Button> : <Button size="sm" variant="secondary" onClick={() => setMode("template")}>Créer la semaine type</Button>}
            </div>
          ) : null}
          {toCover.length ? (
            <div className="mb-4 rounded-2xl border border-orange-500/40 bg-orange-500/10 p-3 text-sm" data-testid="to-cover">
              <b>{toCover.length} service{toCover.length > 1 ? "s" : ""} à remplacer</b> cette semaine (employé en congé ou absent). Touchez un service en orange pour choisir le remplaçant.
            </div>
          ) : null}
          {shifts.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
            <div className="space-y-4">
              <div className="grid gap-2 md:grid-cols-7">
                {days.map((d) => {
                  const list = all.filter((s) => dayOf(s) === d);
                  const isToday = d === today;
                  const dayHours = list.filter((s) => !s.absence).reduce((a, s) => a + hours(s), 0);
                  const off = (absences.data ?? []).filter((a) => isoDay(a.startsOn) <= d && d <= isoDay(a.endsOn));
                  return (
                    <section key={d} className={`card p-2.5 md:min-h-[180px] ${isToday ? "ring-2 ring-lagon-500/40" : ""}`}>
                      <header className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-baseline gap-1.5"><span className={`text-xs font-extrabold uppercase ${isToday ? "text-lagon-600" : ""}`}>{fmtDay(d, { weekday: "short" }).replace(".", "")}</span><span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-extrabold ${isToday ? "bg-brand text-white" : ""}`}>{Number(d.slice(8))}</span>{dayHours ? <span className="text-[11px] text-muted">{fmtHours(dayHours)}</span> : null}</div>
                        <button onClick={() => newShift(d)} className="touch flex h-8 w-8 items-center justify-center rounded-lg text-lagon-600 hover:surface-2" aria-label={`Ajouter un service le ${d}`}><Plus className="h-4 w-4" /></button>
                      </header>
                      {off.length ? <p className="mb-1.5 flex flex-wrap gap-1">{off.map((a) => <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-bold text-orange-700 dark:text-orange-300"><Palmtree className="h-3 w-3" />{a.employee.firstName} · {ABSENCE_KINDS[a.kind as AbsenceKind].toLowerCase()}</span>)}</p> : null}
                      {list.length === 0 ? <button onClick={() => newShift(d)} className="touch flex h-10 w-full items-center justify-center rounded-xl border border-dashed border-line text-xs font-semibold text-muted hover:surface-2 md:h-14">Aucun service · ajouter</button> : (
                        <ul className="space-y-1.5">
                          {list.map((s) => { const c = s.absence ? "#ea580c" : colorOf(s.employeeId); return (
                            <li key={s.id}>
                              <button onClick={() => openShift(s)} data-testid={s.absence ? "shift-to-cover" : "shift"} className={`touch flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition hover:brightness-95 ${s.absence ? "border border-dashed border-orange-500" : ""}`} style={{ background: `color-mix(in srgb, ${c} 12%, transparent)`, borderLeft: `3px solid ${c}` }}>
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white" style={{ background: c }}>{initials(s.employee)}</span>
                                <span className="min-w-0 flex-1">
                                  <span className={`block truncate font-bold ${s.absence ? "line-through decoration-orange-500/70" : ""}`}>{s.employee.firstName} {s.employee.lastName.slice(0, 1)}.{s.templateId && !s.isEdited ? <Repeat className="ml-1 inline h-3 w-3 text-muted" aria-label="semaine type" /> : null}</span>
                                  <span className="block text-muted"><Clock className="mr-1 inline h-3 w-3" />{formatTime(s.startsAt, timezone)} – {formatTime(s.endsAt, timezone)} · {fmtHours(hours(s))}{s.notes ? ` · ${s.notes}` : ""}</span>
                                  {s.absence ? <span className="block font-bold text-orange-700 dark:text-orange-300">{s.absence.label} · à remplacer</span> : null}
                                  {s.replacesEmployee ? <span className="block font-semibold text-lagon-700 dark:text-lagon-300">remplace {s.replacesEmployee.firstName}</span> : null}
                                </span>
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
              {tlist.length && all.length ? <p className="text-center text-xs text-muted"><Repeat className="mr-1 inline h-3 w-3" />Les services marqués de cette icône viennent de la semaine type. <button onClick={keepWeek} className="font-semibold text-lagon-600 hover:underline" data-testid="keep-week">Garder cette semaine comme semaine type</button></p> : null}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">Ce que vous saisissez ici se reporte <b>toute seule chaque semaine</b>. Une modification s&apos;applique aux semaines à venir, sans toucher aux services que vous avez déjà retouchés à la main (remplacements, horaires déplacés).</p>
          {templates.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
            <div className="grid gap-2 md:grid-cols-7">
              {WEEKDAYS.map((label, wd) => {
                const list = tlist.filter((t) => t.weekday === wd);
                return (
                  <section key={wd} className="card p-2.5 md:min-h-[180px]" data-testid={`template-day-${wd}`}>
                    <header className="mb-2 flex items-center justify-between gap-2"><span className="text-xs font-extrabold uppercase">{label}</span><button onClick={() => setTpl({ employeeId: employees.data?.[0]?.id ?? "", weekday: wd, startTime: "11:00", endTime: "15:00", notes: "" })} className="touch flex h-8 w-8 items-center justify-center rounded-lg text-lagon-600 hover:surface-2" aria-label={`Ajouter un service type le ${label.toLowerCase()}`}><Plus className="h-4 w-4" /></button></header>
                    {list.length === 0 ? <p className="py-3 text-center text-xs text-muted">Repos</p> : (
                      <ul className="space-y-1.5">
                        {list.map((t) => { const c = colorOf(t.employeeId); return (
                          <li key={t.id}>
                            <button onClick={() => setTpl({ id: t.id, employeeId: t.employeeId, weekday: t.weekday, startTime: t.startTime, endTime: t.endTime, notes: t.notes ?? "" })} className="touch flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition hover:brightness-95" style={{ background: `color-mix(in srgb, ${c} 12%, transparent)`, borderLeft: `3px solid ${c}` }}>
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white" style={{ background: c }}>{initials(t.employee)}</span>
                              <span className="min-w-0 flex-1"><span className="block truncate font-bold">{t.employee.firstName} {t.employee.lastName.slice(0, 1)}.</span><span className="block text-muted">{t.startTime} – {t.endTime} · {fmtHours(templateHours(t))}{t.notes ? ` · ${t.notes}` : ""}</span></span>
                            </button>
                          </li>
                        ); })}
                      </ul>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Service d'une semaine : modification, remplacement */}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier le service" : "Nouveau service"} size="sm" footer={<div className="flex gap-2">{edit?.id ? <Button variant="danger" onClick={() => act(() => api.delete(`/api/staff/shifts/${edit.id}`), { success: "Supprimé", invalidate: [["staff"]] }).then(() => setEdit(null))}>Supprimer</Button> : null}<Button className="flex-1" disabled={!edit?.employeeId || !edit.startsAt || !edit.endsAt} onClick={() => saveShift()}>Enregistrer</Button></div>}>
        {edit ? <div className="space-y-3">
          {edit.absentName ? (
            <div className="rounded-xl border border-orange-500/40 bg-orange-500/10 p-3 text-sm" data-testid="replace-box">
              <p className="mb-2"><b>{edit.absentName}</b> ce jour-là. Choisissez qui le remplace :</p>
              <div className="flex flex-wrap gap-1.5">
                {(employees.data ?? []).filter((e) => e.id !== edit.employeeId && !absentOn(e.id, editDay)).map((e) => (
                  <button key={e.id} onClick={() => saveShift({ employeeId: e.id })} className="touch inline-flex items-center gap-1.5 rounded-full surface px-3 py-1.5 text-xs font-bold shadow-sm hover:surface-2" data-testid="replace-with"><UserRoundCheck className="h-3.5 w-3.5 text-lagon-600" />{e.firstName} {e.lastName.slice(0, 1)}.</button>
                ))}
              </div>
            </div>
          ) : null}
          {edit.replaces ? <p className="rounded-xl surface-2 px-3 py-2 text-xs">Remplace <b>{edit.replaces}</b>, prévu au départ.</p> : null}
          <Field label="Employé"><Select value={edit.employeeId} onChange={(e) => setEdit({ ...edit, employeeId: e.target.value })}>{employees.data?.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}{e.jobTitle ? ` · ${e.jobTitle}` : ""}{absentOn(e.id, editDay) ? " · absent" : ""}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Début"><Input type="datetime-local" value={edit.startsAt} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} /></Field><Field label="Fin"><Input type="datetime-local" value={edit.endsAt} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} /></Field></div>
          <Field label="Note"><Input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} placeholder="Service du midi, terrasse…" /></Field>
          {edit.id ? <p className="text-xs text-muted">Ce changement ne vaut que pour ce jour-là. Pour changer toutes les semaines, modifiez la semaine type.</p> : null}
        </div> : null}
      </Modal>

      {/* Ligne de la semaine type */}
      <Modal open={!!tpl} onClose={() => setTpl(null)} title={tpl?.id ? "Modifier le service type" : "Nouveau service type"} size="sm" footer={<div className="flex gap-2">{tpl?.id ? <Button variant="danger" onClick={() => confirm("Retirer ce service de la semaine type ? Il disparaîtra des semaines à venir (sauf s'il a été retouché à la main).") && act(() => api.delete(`/api/staff/templates/${tpl.id}`), { success: "Retiré de la semaine type", invalidate: [["staff"]] }).then(() => setTpl(null))}><Trash2 className="h-4 w-4" /></Button> : null}<Button className="flex-1" disabled={!tpl?.employeeId || !tpl.startTime || !tpl.endTime} onClick={saveTemplate} data-testid="save-template">Enregistrer</Button></div>}>
        {tpl ? <div className="space-y-3">
          <Field label="Employé"><Select value={tpl.employeeId} onChange={(e) => setTpl({ ...tpl, employeeId: e.target.value })}>{employees.data?.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}{e.jobTitle ? ` · ${e.jobTitle}` : ""}</option>)}</Select></Field>
          <Field label="Jour"><Select value={String(tpl.weekday)} onChange={(e) => setTpl({ ...tpl, weekday: Number(e.target.value) })}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>Chaque {w.toLowerCase()}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Début"><Input type="time" value={tpl.startTime} onChange={(e) => setTpl({ ...tpl, startTime: e.target.value })} /></Field><Field label="Fin" hint={tpl.endTime && tpl.startTime && tpl.endTime <= tpl.startTime ? "Finit le lendemain" : undefined}><Input type="time" value={tpl.endTime} onChange={(e) => setTpl({ ...tpl, endTime: e.target.value })} /></Field></div>
          <Field label="Note"><Input value={tpl.notes} onChange={(e) => setTpl({ ...tpl, notes: e.target.value })} placeholder="Ouverture, cuisine, terrasse…" /></Field>
        </div> : null}
      </Modal>

      {/* Nouveau congé */}
      <Modal open={!!leave} onClose={() => setLeave(null)} title="Congé ou absence" size="sm" footer={<Button className="w-full" disabled={!leave?.employeeId || !leave.startsOn || !leave.endsOn || leave.endsOn < leave.startsOn} onClick={saveLeave} data-testid="save-absence">Enregistrer</Button>}>
        {leave ? <div className="space-y-3">
          <Field label="Employé"><Select value={leave.employeeId} onChange={(e) => setLeave({ ...leave, employeeId: e.target.value })}>{employees.data?.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}</Select></Field>
          <div className="grid grid-cols-2 gap-2"><Field label="Du"><Input type="date" value={leave.startsOn} onChange={(e) => setLeave({ ...leave, startsOn: e.target.value, endsOn: leave.endsOn < e.target.value ? e.target.value : leave.endsOn })} /></Field><Field label="Au (inclus)"><Input type="date" value={leave.endsOn} min={leave.startsOn} onChange={(e) => setLeave({ ...leave, endsOn: e.target.value })} /></Field></div>
          <Field label="Motif"><Select value={leave.kind} onChange={(e) => setLeave({ ...leave, kind: e.target.value as AbsenceKind })}>{Object.entries(ABSENCE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Note"><Input value={leave.notes} onChange={(e) => setLeave({ ...leave, notes: e.target.value })} placeholder="Facultatif" /></Field>
          <p className="text-xs text-muted">Ses services sur la période restent affichés en orange « à remplacer » : touchez-les pour choisir un remplaçant.</p>
        </div> : null}
      </Modal>

      <Modal open={cover !== null} onClose={() => setCover(null)} title="Congé enregistré" size="sm" footer={<Button className="w-full" onClick={() => setCover(null)}>Voir les services à remplacer</Button>}>
        <p className="text-sm">{cover} service{(cover ?? 0) > 1 ? "s" : ""} de cet employé tombe{(cover ?? 0) > 1 ? "nt" : ""} pendant son absence. Ils apparaissent en orange dans le planning : touchez chacun pour choisir le remplaçant.</p>
      </Modal>

      <AbsencesList open={leaveList} onClose={() => setLeaveList(false)} today={today} empName={empName} />
    </div>
  );
}

/** Liste des congés à venir et en cours */
function AbsencesList({ open, onClose, today, empName }: { open: boolean; onClose: () => void; today: string; empName: (id: string) => string }) {
  const act = useAction();
  const q = useList<Absence[]>(["staff", "absences", "upcoming", today], `/api/staff/absences?from=${today}&to=${addDays(today, 365)}`, open);
  const fmt = (d: string | Date) => new Date(isoDay(d) + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return (
    <Modal open={open} onClose={onClose} title="Congés et absences à venir" size="md">
      {q.isLoading ? <div className="flex justify-center py-6"><Spinner /></div> : !q.data?.length ? <p className="py-4 text-center text-sm text-muted">Aucun congé prévu.</p> : (
        <ul className="divide-y divide-line">
          {q.data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5 text-sm" data-testid="absence-row">
              <Palmtree className="h-4 w-4 shrink-0 text-orange-600" />
              <span className="min-w-0 flex-1"><b>{empName(a.employeeId) || `${a.employee.firstName} ${a.employee.lastName}`}</b> · {ABSENCE_KINDS[a.kind as AbsenceKind]}<span className="block text-xs text-muted">du {fmt(a.startsOn)} au {fmt(a.endsOn)}{a.notes ? ` · ${a.notes}` : ""}</span></span>
              <button onClick={() => confirm("Supprimer ce congé ? Les services de l'employé redeviennent normaux.") && act(() => api.delete(`/api/staff/absences/${a.id}`), { success: "Congé supprimé", invalidate: [["staff"]] })} className="text-xs font-semibold text-red-600">Supprimer</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
