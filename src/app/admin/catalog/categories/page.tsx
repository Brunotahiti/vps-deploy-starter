"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Toggle } from "@/components/ui/field";
import { Spinner } from "@/components/ui/misc";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { CatalogTabs } from "@/components/admin/catalog-tabs";
import type { listCategories } from "@/server/services/catalog";

type Cat = Awaited<ReturnType<typeof listCategories>>[number];
const COLORS = ["#0EA5A4", "#22C55E", "#F97316", "#EC4899", "#3B82F6", "#8B5CF6", "#EAB308", "#EF4444", "#64748B"];

export default function CategoriesPage() {
  const act = useAction();
  const q = useList<Cat[]>(["categories"], "/api/categories");
  const [edit, setEdit] = useState<{ id?: string; name: string; color: string; parentId: string; isActive: boolean } | null>(null);
  const save = async () => {
    if (!edit) return;
    const body = { name: edit.name, color: edit.color, parentId: edit.parentId || null, isActive: edit.isActive };
    const r = await act(() => (edit.id ? api.patch(`/api/categories/${edit.id}`, body) : api.post("/api/categories", body)), { success: "Catégorie enregistrée", invalidate: [["categories"], ["pos-catalog"]] });
    if (r) setEdit(null);
  };
  const move = async (i: number, dir: -1 | 1) => {
    const ids = (q.data ?? []).map((c) => c.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await act(() => api.post("/api/categories/reorder", { ids }), { invalidate: [["categories"], ["pos-catalog"]] });
  };
  return (
    <div>
      <PageHeader title="Catalogue" subtitle="Catégories et sous-catégories — l'ordre est celui de la caisse" action={<Button onClick={() => setEdit({ name: "", color: COLORS[0], parentId: "", isActive: true })}>Nouvelle catégorie</Button>} />
      <CatalogTabs />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Ordre", "Nom", "Parent", "Produits", "Statut", ""]}>
          {q.data?.map((c, i) => (
            <Tr key={c.id}>
              <Td><button onClick={() => move(i, -1)} className="px-1 text-muted">▲</button><button onClick={() => move(i, 1)} className="px-1 text-muted">▼</button></Td>
              <Td><span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ background: c.color }} /><span className="font-semibold">{c.name}</span></Td><Td>{q.data?.find((p) => p.id === c.parentId)?.name ?? "—"}</Td><Td>{c._count.products}</Td><Td>{c.isActive ? "Active" : "Masquée"}</Td>
              <Td className="space-x-3"><button onClick={() => setEdit({ id: c.id, name: c.name, color: c.color, parentId: c.parentId ?? "", isActive: c.isActive })} className="text-xs font-semibold text-lagon-600">Modifier</button><button onClick={() => confirm(`Supprimer « ${c.name} » ? Les produits resteront sans catégorie.`) && act(() => api.delete(`/api/categories/${c.id}`), { success: "Supprimée", invalidate: [["categories"], ["products"], ["pos-catalog"]] })} className="text-xs font-semibold text-red-600">Supprimer</button></Td>
            </Tr>
          ))}
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier la catégorie" : "Nouvelle catégorie"} size="sm" footer={<Button className="w-full" disabled={!edit?.name} onClick={save}>Enregistrer</Button>}>
        {edit ? <div className="space-y-3">
          <Field label="Nom"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Couleur"><div className="flex flex-wrap gap-2">{COLORS.map((c) => <button key={c} type="button" onClick={() => setEdit({ ...edit, color: c })} className={`h-9 w-9 rounded-full ${edit.color === c ? "ring-2 ring-offset-2 ring-lagon-500" : ""}`} style={{ background: c }} />)}</div></Field>
          <Field label="Sous-catégorie de"><Select value={edit.parentId} onChange={(e) => setEdit({ ...edit, parentId: e.target.value })}><option value="">— (catégorie principale)</option>{q.data?.filter((c) => c.id !== edit.id && !c.parentId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Toggle checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Visible en caisse" />
        </div> : null}
      </Modal>
    </div>
  );
}
