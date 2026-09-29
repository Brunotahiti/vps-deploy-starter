"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import type { Establishment } from "@/generated/prisma/client";

export default function EstablishmentsPage() {
  const { me, can } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const act = useAction();
  const q = useList<Establishment[]>(["establishments"], "/api/establishments");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", city: "" });
  const switchTo = async (id: string) => { await api.post("/api/auth/switch-establishment", { establishmentId: id }); qc.clear(); router.push("/admin"); };
  return (
    <div>
      <PageHeader title="Établissements" subtitle="Tous vos restaurants, depuis un seul compte" action={can("establishments.manage") ? <Button onClick={() => setOpen(true)}>Nouvel établissement</Button> : null} />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["Nom", "Ville", "N° Tahiti", "Devise", "Onboarding", ""]}>
          {q.data?.map((e) => (
            <Tr key={e.id}><Td className="font-semibold">{e.name}{me?.establishment?.id === e.id ? <Badge color="teal">actuel</Badge> : null}</Td><Td>{e.city ?? "—"}</Td><Td>{e.tahitiNumber ?? "—"}</Td><Td>{e.currency}</Td><Td>{e.onboardingDone ? <Badge color="green">terminé</Badge> : <Badge color="orange">étape {e.onboardingStep}/15</Badge>}</Td><Td>{me?.establishment?.id !== e.id ? <Button size="sm" variant="outline" onClick={() => switchTo(e.id)}>Basculer</Button> : null}</Td></Tr>
          ))}
        </Table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Nouvel établissement" size="sm">
        <div className="space-y-3">
          <Field label="Nom"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Restaurant B — Punaauia" /></Field>
          <Field label="Ville"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Button className="w-full" disabled={!form.name} onClick={async () => { const r = await act(() => api.post("/api/establishments", { name: form.name, city: form.city || null }), { success: "Établissement créé", invalidate: [["establishments"], ["me"]] }); if (r) { setOpen(false); setForm({ name: "", city: "" }); } }}>Créer</Button>
        </div>
      </Modal>
    </div>
  );
}
