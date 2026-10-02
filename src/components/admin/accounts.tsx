"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea, Toggle } from "@/components/ui/field";

export type AccountRow = {
  id: string; name: string; tahitiNumber: string | null; contactName: string | null; email: string | null; phone: string | null; address: string | null;
  creditLimit: number | null; paymentTermsDays: number; notes: string | null; isActive: boolean; balance: number; uninvoiced: number; overdue: number;
};
export const SETTLEMENT_LABEL: Record<string, string> = { CASH: "Espèces", CARD: "Carte bancaire", CHECK: "Chèque", TRANSFER: "Virement" };

/** Création / modification d'un compte client pro. */
export function AccountForm({ account, onClose }: { account?: Partial<AccountRow> & { id: string }; onClose: () => void }) {
  const act = useAction();
  const [f, setF] = useState({
    name: account?.name ?? "", tahitiNumber: account?.tahitiNumber ?? "", contactName: account?.contactName ?? "", email: account?.email ?? "", phone: account?.phone ?? "",
    address: account?.address ?? "", creditLimit: account?.creditLimit != null ? String(account.creditLimit) : "", paymentTermsDays: String(account?.paymentTermsDays ?? 30), notes: account?.notes ?? "", isActive: account?.isActive ?? true,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const limit = f.creditLimit.replace(/\s/g, "");
  const valid = f.name.trim() && (!limit || /^\d+$/.test(limit));
  const save = async () => {
    if (!valid) return;
    const body = { name: f.name, tahitiNumber: f.tahitiNumber || null, contactName: f.contactName || null, email: f.email || null, phone: f.phone || null, address: f.address || null, creditLimit: limit ? Number(limit) : null, paymentTermsDays: Number(f.paymentTermsDays), notes: f.notes || null, isActive: f.isActive };
    const r = await act(() => (account ? api.patch(`/api/accounts/${account.id}`, body) : api.post("/api/accounts", body)), { success: account ? "Compte mis à jour" : "Compte créé", invalidate: [["accounts"]] });
    if (r) onClose();
  };
  return (
    <Modal open onClose={onClose} size="md" title={account ? "Modifier le compte" : "Nouveau compte client"} footer={<Button size="lg" className="w-full" onClick={save} disabled={!valid} data-testid="account-save">Enregistrer</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Raison sociale ou nom" className="sm:col-span-2"><Input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="ex. Mairie de Punaauia" aria-label="Raison sociale" /></Field>
        <Field label="N° Tahiti"><Input value={f.tahitiNumber} onChange={(e) => set("tahitiNumber", e.target.value)} aria-label="N° Tahiti du client" /></Field>
        <Field label="Contact"><Input value={f.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="Service comptable…" aria-label="Contact" /></Field>
        <Field label="E-mail (factures et relances)"><Input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} aria-label="E-mail" /></Field>
        <Field label="Téléphone"><Input value={f.phone} onChange={(e) => set("phone", e.target.value)} aria-label="Téléphone" /></Field>
        <Field label="Adresse de facturation" className="sm:col-span-2"><Textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} aria-label="Adresse" /></Field>
        <Field label="Plafond d'encours (F CFP)" hint="Vide : sans plafond"><Input inputMode="numeric" value={f.creditLimit} onChange={(e) => set("creditLimit", e.target.value)} aria-label="Plafond d'encours" /></Field>
        <Field label="Délai de paiement"><Select value={f.paymentTermsDays} onChange={(e) => set("paymentTermsDays", e.target.value)} aria-label="Délai de paiement">{[0, 15, 30, 45, 60].map((d) => <option key={d} value={d}>{d === 0 ? "À réception" : `${d} jours`}</option>)}</Select></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Bon de commande exigé, personnes autorisées…" aria-label="Notes" /></Field>
        {account ? <div className="sm:col-span-2"><Toggle checked={f.isActive} onChange={(v) => set("isActive", v)} label="Compte ouvert (utilisable à la caisse)" /></div> : null}
      </div>
    </Modal>
  );
}
