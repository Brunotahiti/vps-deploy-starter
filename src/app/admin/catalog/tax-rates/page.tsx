"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { formatBps } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Toggle } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { CatalogTabs } from "@/components/admin/catalog-tabs";
import type { TaxRate } from "@/generated/prisma/client";

export default function TaxRatesPage() {
  const act = useAction();
  const q = useList<TaxRate[]>(["tax-rates"], "/api/tax-rates");
  const [edit, setEdit] = useState<{ id?: string; name: string; pct: string; isDefault: boolean; isActive: boolean } | null>(null);
  const save = async () => {
    if (!edit) return;
    const body = { name: edit.name, rateBps: Math.round(Number(edit.pct.replace(",", ".")) * 100), isDefault: edit.isDefault, isActive: edit.isActive };
    const r = await act(() => (edit.id ? api.patch(`/api/tax-rates/${edit.id}`, body) : api.post("/api/tax-rates", body)), { success: "Taux enregistré", invalidate: [["tax-rates"], ["pos-catalog"], ["products"]] });
    if (r) setEdit(null);
  };
  return (
    <div>
      <PageHeader title="Catalogue" subtitle="Moteur de TVA configurable : aucun taux n'est figé dans le code. Les tickets ventilent HT / TVA par taux / TTC." action={<Button onClick={() => setEdit({ name: "", pct: "", isDefault: false, isActive: true })}>Nouveau taux</Button>} />
      <CatalogTabs />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Nom", "Taux", "Par défaut", "Statut", ""]}>
          {q.data?.map((t) => (
            <Tr key={t.id}><Td className="font-semibold">{t.name}</Td><Td className="font-mono">{formatBps(t.rateBps)}</Td><Td>{t.isDefault ? <Badge color="teal">défaut</Badge> : ""}</Td><Td>{t.isActive ? "Actif" : "Inactif"}</Td>
              <Td className="space-x-3"><button onClick={() => setEdit({ id: t.id, name: t.name, pct: String(t.rateBps / 100), isDefault: t.isDefault, isActive: t.isActive })} className="text-xs font-semibold text-lagon-600">Modifier</button><button onClick={() => confirm(`Supprimer « ${t.name} » ?`) && act(() => api.delete(`/api/tax-rates/${t.id}`), { success: "Supprimé", invalidate: [["tax-rates"]] })} className="text-xs font-semibold text-red-600">Supprimer</button></Td></Tr>
          ))}
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier le taux" : "Nouveau taux de TVA"} size="sm" footer={<Button className="w-full" disabled={!edit?.name || edit.pct === ""} onClick={save}>Enregistrer</Button>}>
        {edit ? <div className="space-y-3"><Field label="Nom"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="TVA restauration" /></Field><Field label="Taux (%)" hint="0 pour un article exonéré"><Input value={edit.pct} onChange={(e) => setEdit({ ...edit, pct: e.target.value })} placeholder="13" /></Field><Toggle checked={edit.isDefault} onChange={(v) => setEdit({ ...edit, isDefault: v })} label="Taux par défaut des nouveaux produits" /><Toggle checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Actif" /></div> : null}
      </Modal>
    </div>
  );
}
