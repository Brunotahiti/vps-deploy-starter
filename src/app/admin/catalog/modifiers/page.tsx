"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Toggle } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { CatalogTabs } from "@/components/admin/catalog-tabs";
import type { listModifierGroups } from "@/server/services/catalog";

type Group = Awaited<ReturnType<typeof listModifierGroups>>[number];
type Form = { id?: string; name: string; minSelect: string; maxSelect: string; modifiers: { id?: string; name: string; priceDelta: string; isDefault: boolean; isAvailable: boolean }[] };

export default function ModifiersPage() {
  const act = useAction();
  const q = useList<Group[]>(["modifier-groups"], "/api/modifier-groups");
  const [edit, setEdit] = useState<Form | null>(null);
  const mode = (g: Group) => (g.minSelect > 0 ? "Obligatoire" : "Facultatif") + " · " + (g.maxSelect === 1 ? "choix unique" : g.maxSelect ? `max ${g.maxSelect}` : "choix multiples");
  const save = async () => {
    if (!edit) return;
    const body = { name: edit.name, minSelect: Number(edit.minSelect || 0), maxSelect: edit.maxSelect === "" ? null : Number(edit.maxSelect), modifiers: edit.modifiers.filter((m) => m.name).map((m) => ({ id: m.id, name: m.name, priceDelta: Number(m.priceDelta || 0), isDefault: m.isDefault, isAvailable: m.isAvailable })) };
    const r = await act(() => (edit.id ? api.patch(`/api/modifier-groups/${edit.id}`, body) : api.post("/api/modifier-groups", body)), { success: "Groupe enregistré", invalidate: [["modifier-groups"], ["pos-catalog"], ["products"]] });
    if (r) setEdit(null);
  };
  const setMod = (i: number, patch: Partial<Form["modifiers"][number]>) => setEdit((e) => (e ? { ...e, modifiers: e.modifiers.map((m, j) => (j === i ? { ...m, ...patch } : m)) } : e));
  return (
    <div>
      <PageHeader title="Catalogue" subtitle="Groupes d'options : cuisson, accompagnement, suppléments payants…" action={<Button onClick={() => setEdit({ name: "", minSelect: "0", maxSelect: "", modifiers: [{ name: "", priceDelta: "0", isDefault: false, isAvailable: true }] })}>Nouveau groupe</Button>} />
      <CatalogTabs />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Groupe", "Règle", "Options", "Produits liés", ""]}>
          {q.data?.map((g) => (
            <Tr key={g.id}>
              <Td className="font-semibold">{g.name}</Td><Td>{mode(g)}</Td><Td>{g.modifiers.map((m) => <span key={m.id} className={`mr-1 inline-block rounded-md surface-2 px-1.5 py-0.5 text-xs ${m.isAvailable ? "" : "line-through opacity-50"}`}>{m.name}{m.priceDelta ? <> +<Money amount={m.priceDelta} /></> : ""}</span>)}</Td><Td>{g._count.products}</Td>
              <Td className="space-x-3"><button onClick={() => setEdit({ id: g.id, name: g.name, minSelect: String(g.minSelect), maxSelect: g.maxSelect === null ? "" : String(g.maxSelect), modifiers: g.modifiers.map((m) => ({ id: m.id, name: m.name, priceDelta: String(m.priceDelta), isDefault: m.isDefault, isAvailable: m.isAvailable })) })} className="text-xs font-semibold text-lagon-600">Modifier</button><button onClick={() => confirm(`Supprimer « ${g.name} » ?`) && act(() => api.delete(`/api/modifier-groups/${g.id}`), { success: "Supprimé", invalidate: [["modifier-groups"], ["pos-catalog"], ["products"]] })} className="text-xs font-semibold text-red-600">Supprimer</button></Td>
            </Tr>
          ))}
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier le groupe" : "Nouveau groupe d'options"} size="lg" footer={<Button className="w-full" disabled={!edit?.name || !edit.modifiers.some((m) => m.name)} onClick={save}>Enregistrer</Button>}>
        {edit ? <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Nom du groupe"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Cuisson" /></Field>
            <Field label="Minimum de choix" hint="> 0 = obligatoire"><Input type="number" min={0} value={edit.minSelect} onChange={(e) => setEdit({ ...edit, minSelect: e.target.value })} /></Field>
            <Field label="Maximum de choix" hint="vide = illimité, 1 = choix unique"><Select value={edit.maxSelect} onChange={(e) => setEdit({ ...edit, maxSelect: e.target.value })}><option value="">Illimité</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-muted">Options</p>
            {edit.modifiers.map((m, i) => <div key={i} className="mb-2 flex flex-wrap items-center gap-2"><Input placeholder="Nom" value={m.name} onChange={(e) => setMod(i, { name: e.target.value })} className="flex-1" /><Input type="number" placeholder="Supplément" value={m.priceDelta} onChange={(e) => setMod(i, { priceDelta: e.target.value })} className="w-32" /><Toggle checked={m.isDefault} onChange={(v) => setMod(i, { isDefault: v })} label="Par défaut" /><Toggle checked={m.isAvailable} onChange={(v) => setMod(i, { isAvailable: v })} label="Dispo" /><Button variant="ghost" onClick={() => setEdit({ ...edit, modifiers: edit.modifiers.filter((_, j) => j !== i) })}>✕</Button></div>)}
            <Button size="sm" variant="outline" onClick={() => setEdit({ ...edit, modifiers: [...edit.modifiers, { name: "", priceDelta: "0", isDefault: false, isAvailable: true }] })}>+ Option</Button>
          </div>
        </div> : null}
      </Modal>
    </div>
  );
}
