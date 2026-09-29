"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Toggle } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { formatTime } from "@/lib/dates";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { StaffTabs } from "@/components/admin/staff-tabs";
import { fmtHours, type Employee, type Present } from "@/components/admin/staff-types";
import type { listUsers } from "@/server/services/users";

type U = Awaited<ReturnType<typeof listUsers>>[number];
type Form = { id?: string; userId: string; firstName: string; lastName: string; jobTitle: string; hourlyCost: string; pin: string; isActive: boolean };

export default function StaffPage() {
  const { timezone } = useSession();
  const act = useAction();
  const q = useList<Employee[]>(["staff", "employees"], "/api/staff/employees?all=1");
  const users = useList<U[]>(["users"], "/api/users");
  const present = useList<Present[]>(["staff", "present"], "/api/staff/present");
  const [edit, setEdit] = useState<Form | null>(null);
  const save = async () => {
    if (!edit) return;
    const body = { userId: edit.userId || null, firstName: edit.firstName, lastName: edit.lastName, jobTitle: edit.jobTitle || null, hourlyCost: edit.hourlyCost ? Number(edit.hourlyCost) : null, pin: edit.pin || null, isActive: edit.isActive };
    const r = await act(() => (edit.id ? api.patch(`/api/staff/employees/${edit.id}`, body) : api.post("/api/staff/employees", body)), { success: "Employé enregistré", invalidate: [["staff"]] });
    if (r) setEdit(null);
  };
  return (
    <div>
      <PageHeader title="Personnel" subtitle="Fiches employés, coût horaire, PIN de pointage" action={<div className="flex gap-2"><Button variant="secondary" onClick={() => act(() => api.post<{ created: number }>("/api/staff/employees/from-users"), { invalidate: [["staff"]] }).then((r) => r && alert(`${r.created} fiche(s) créée(s) depuis les utilisateurs`))}>Depuis les utilisateurs</Button><Button onClick={() => setEdit({ userId: "", firstName: "", lastName: "", jobTitle: "", hourlyCost: "", pin: "", isActive: true })}>Nouvel employé</Button></div>} />
      <StaffTabs />
      {present.data && present.data.length > 0 ? <div className="mb-4 flex flex-wrap gap-2">{present.data.map((p) => <span key={p.id} className={`rounded-full px-3 py-1 text-xs font-bold ${p.state === "BREAK" ? "bg-orange-500/15 text-orange-700" : "bg-green-500/15 text-green-700"}`}>{p.firstName} · {p.state === "BREAK" ? "en pause" : "en service"}{p.since ? ` depuis ${formatTime(p.since, timezone)}` : ""} · {fmtHours(p.workedMs / 3600000)}</span>)}</div> : <p className="mb-4 text-sm text-muted">Personne n&apos;est pointé actuellement.</p>}
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Employé", "Poste", "Compte", "Coût horaire", "PIN pointage", "Statut", ""]}>
          {q.data?.map((e) => (
            <Tr key={e.id}>
              <Td className="font-semibold">{e.firstName} {e.lastName}</Td><Td>{e.jobTitle ?? "—"}</Td><Td className="text-xs">{e.user ? e.user.email : <span className="text-muted">aucun</span>}</Td><Td>{e.hourlyCost !== null ? <><Money amount={e.hourlyCost} /> / h</> : <span className="text-muted">—</span>}</Td>
              <Td>{e.hasPin ? <Badge color="teal">PIN employé</Badge> : e.user ? <Badge color="gray">PIN du compte</Badge> : <Badge color="orange">aucun</Badge>}</Td><Td>{e.isActive ? <Badge color="green">actif</Badge> : <Badge color="gray">archivé</Badge>}</Td>
              <Td className="space-x-3 whitespace-nowrap"><button onClick={() => setEdit({ id: e.id, userId: e.userId ?? "", firstName: e.firstName, lastName: e.lastName, jobTitle: e.jobTitle ?? "", hourlyCost: e.hourlyCost !== null ? String(e.hourlyCost) : "", pin: "", isActive: e.isActive })} className="text-xs font-semibold text-lagon-600">Modifier</button>{e.isActive ? <button onClick={() => confirm(`Archiver ${e.firstName} ${e.lastName} ?`) && act(() => api.delete(`/api/staff/employees/${e.id}`), { success: "Archivé", invalidate: [["staff"]] })} className="text-xs font-semibold text-red-600">Archiver</button> : null}</Td>
            </Tr>
          ))}
          {q.data?.length === 0 ? <Tr><Td className="py-8 text-center text-muted">Aucun employé : créez les fiches depuis vos utilisateurs ou manuellement (extras, plonge…).</Td></Tr> : null}
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier l'employé" : "Nouvel employé"} size="md" footer={<Button className="w-full" disabled={!edit?.firstName || !edit.lastName} onClick={save}>Enregistrer</Button>}>
        {edit ? <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prénom"><Input value={edit.firstName} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} /></Field>
          <Field label="Nom"><Input value={edit.lastName} onChange={(e) => setEdit({ ...edit, lastName: e.target.value })} /></Field>
          <Field label="Poste"><Input value={edit.jobTitle} onChange={(e) => setEdit({ ...edit, jobTitle: e.target.value })} placeholder="Serveur, Chef, Plonge…" /></Field>
          <Field label="Coût horaire chargé (F)" hint="Sert au calcul du coût du personnel"><Input type="number" value={edit.hourlyCost} onChange={(e) => setEdit({ ...edit, hourlyCost: e.target.value })} /></Field>
          <Field label="Compte utilisateur lié" hint="Permet de pointer avec le PIN du compte" className="sm:col-span-2"><Select value={edit.userId} onChange={(e) => { const u = users.data?.find((x) => x.id === e.target.value); setEdit({ ...edit, userId: e.target.value, ...(u && !edit.firstName ? { firstName: u.firstName, lastName: u.lastName } : {}) }); }}><option value="">— aucun (extra, sans accès à l&apos;application) —</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName} · {u.email}</option>)}</Select></Field>
          <Field label={edit.id ? "Nouveau PIN de pointage (laisser vide)" : "PIN de pointage (4 à 6 chiffres)"} hint="Facultatif si un compte est lié"><Input inputMode="numeric" value={edit.pin} onChange={(e) => setEdit({ ...edit, pin: e.target.value.replace(/\D/g, "").slice(0, 6) })} /></Field>
          <div className="flex items-end"><Toggle checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Employé actif" /></div>
        </div> : null}
      </Modal>
    </div>
  );
}
