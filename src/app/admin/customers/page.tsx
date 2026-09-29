"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { PageHeader, Table, Tr, Td, useAction } from "@/components/admin/common";
import type { listCustomers, getCustomerCard } from "@/server/services/customers";

type Row = Awaited<ReturnType<typeof listCustomers>>[number];
type Card = Awaited<ReturnType<typeof getCustomerCard>>;
type Form = { id?: string; firstName: string; lastName: string; phone: string; email: string; notes: string; allergies: string };

/** Clients : fiche, historique, points de fidélité et ajustements. */
export default function CustomersPage() {
  const act = useAction();
  const [search, setSearch] = useState("");
  const q = useQuery({ queryKey: ["customers", search], queryFn: () => api.get<Row[]>(`/api/customers?search=${encodeURIComponent(search)}`) });
  const [edit, setEdit] = useState<Form | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const card = useQuery({ queryKey: ["customer", selId], queryFn: () => api.get<Card>(`/api/customers/${selId}`), enabled: !!selId });
  const [adjust, setAdjust] = useState({ points: "", reason: "" });
  const save = async () => {
    if (!edit) return;
    const body = { firstName: edit.firstName || null, lastName: edit.lastName || null, phone: edit.phone || null, email: edit.email || null, notes: edit.notes || null, allergies: edit.allergies || null };
    const r = await act(() => (edit.id ? api.patch(`/api/customers/${edit.id}`, body) : api.post("/api/customers", body)), { success: "Client enregistré", invalidate: [["customers"], ["customer"]] });
    if (r) setEdit(null);
  };
  const c = card.data;
  return (
    <div>
      <PageHeader title="Clients & fidélité" subtitle="Fiches clients, visites, dépenses et points" action={<Button onClick={() => setEdit({ firstName: "", lastName: "", phone: "", email: "", notes: "", allergies: "" })}>Nouveau client</Button>} />
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher par nom, téléphone, email…" className="mb-3 w-80!" />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Client", "Contact", "Visites", "Dépensé", "Points", "Réservations", ""]}>
          {q.data?.map((r) => <Tr key={r.id} onClick={() => setSelId(r.id)}><Td className="font-semibold">{r.firstName} {r.lastName}{r.allergies ? <Badge color="orange">allergies</Badge> : null}</Td><Td className="text-xs">{[r.phone, r.email].filter(Boolean).join(" · ")}</Td><Td>{r.visitCount}</Td><Td className="font-semibold"><Money amount={r.totalSpent} /></Td><Td className="font-bold text-brand">{r.points}</Td><Td>{r._count.reservations}</Td><Td><button onClick={(e) => { e.stopPropagation(); setEdit({ id: r.id, firstName: r.firstName ?? "", lastName: r.lastName ?? "", phone: r.phone ?? "", email: r.email ?? "", notes: r.notes ?? "", allergies: r.allergies ?? "" }); }} className="text-xs font-semibold text-lagon-600">Modifier</button></Td></Tr>)}
          {q.data?.length === 0 ? <Tr><Td className="py-8 text-center text-muted">Aucun client</Td></Tr> : null}
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier le client" : "Nouveau client"} size="md" footer={<Button className="w-full" disabled={!edit?.firstName && !edit?.lastName && !edit?.phone} onClick={save}>Enregistrer</Button>}>
        {edit ? <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Prénom"><Input value={edit.firstName} onChange={(e) => setEdit({ ...edit, firstName: e.target.value })} /></Field><Field label="Nom"><Input value={edit.lastName} onChange={(e) => setEdit({ ...edit, lastName: e.target.value })} /></Field>
          <Field label="Téléphone"><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field><Field label="Email"><Input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label="Allergies" className="sm:col-span-2"><Input value={edit.allergies} onChange={(e) => setEdit({ ...edit, allergies: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </div> : null}
      </Modal>
      <Modal open={!!selId} onClose={() => setSelId(null)} title={c ? `${c.firstName ?? ""} ${c.lastName ?? ""}` : "Client"} size="md">
        {!c ? <Spinner /> : <div className="space-y-3">
          <p className="text-sm text-muted">{[c.phone, c.email].filter(Boolean).join(" · ")}{c.allergies ? <span className="block font-semibold text-corail-500">⚠ {c.allergies}</span> : null}{c.notes ? <span className="block italic">{c.notes}</span> : null}</p>
          <div className="grid grid-cols-3 gap-2 text-center"><div className="rounded-xl surface-2 p-3"><p className="text-[11px] font-bold uppercase text-muted">Visites</p><p className="text-xl font-extrabold">{c.visitCount}</p></div><div className="rounded-xl surface-2 p-3"><p className="text-[11px] font-bold uppercase text-muted">Dépensé</p><p className="text-xl font-extrabold"><Money amount={c.totalSpent} /></p></div><div className="rounded-xl surface-2 p-3"><p className="text-[11px] font-bold uppercase text-muted">Points</p><p className="text-xl font-extrabold text-brand">{c.points}</p></div></div>
          <div className="flex items-end gap-2"><Field label="Ajuster les points (+/−)"><Input type="number" value={adjust.points} onChange={(e) => setAdjust({ ...adjust, points: e.target.value })} className="w-28!" /></Field><Field label="Motif" className="flex-1"><Input value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} /></Field><Button disabled={!adjust.points || !adjust.reason} onClick={() => act(() => api.post(`/api/customers/${c.id}/points`, { points: Number(adjust.points), reason: adjust.reason }), { success: "Points ajustés", invalidate: [["customers"], ["customer"]] }).then(() => setAdjust({ points: "", reason: "" }))}>OK</Button></div>
          {c.transactions.length ? <ul className="max-h-48 overflow-y-auto text-xs">{c.transactions.map((t) => <li key={t.id} className="flex justify-between border-b border-line py-1"><span>{t.reason}</span><span className={t.points < 0 ? "font-bold text-red-600" : "font-bold text-green-600"}>{t.points > 0 ? "+" : ""}{t.points}</span></li>)}</ul> : <p className="text-xs text-muted">Aucun mouvement de points</p>}
        </div>}
      </Modal>
    </div>
  );
}
