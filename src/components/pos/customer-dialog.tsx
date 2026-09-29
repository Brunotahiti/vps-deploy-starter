"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/api-client";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { useToast } from "@/components/ui/toast";
import type { getCustomerCard, listCustomers } from "@/server/services/customers";

type Card = Awaited<ReturnType<typeof getCustomerCard>>;
type Row = Awaited<ReturnType<typeof listCustomers>>[number];

/** Client de la commande : recherche / création, fiche fidélité, utilisation d'une récompense. */
export function CustomerDialog({ open, orderId, customerId, closed, onClose, onChanged }: { open: boolean; orderId: string; customerId: string | null; closed: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [create, setCreate] = useState<{ firstName: string; lastName: string; phone: string; email: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const card = useQuery({ queryKey: ["customer", customerId], queryFn: () => api.get<Card>(`/api/customers/${customerId}`), enabled: open && !!customerId });
  const results = useQuery({ queryKey: ["customers", "search", search], queryFn: () => api.get<Row[]>(`/api/customers?search=${encodeURIComponent(search)}&take=20`), enabled: open && !customerId && search.trim().length >= 2 });
  const run = async (fn: () => Promise<unknown>, msg?: string) => { setBusy(true); try { await fn(); if (msg) toast(msg, "success"); onChanged(); } catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); } finally { setBusy(false); } };
  const attach = (id: string | null) => run(() => api.post(`/api/orders/${orderId}/customer`, { customerId: id }), id ? "Client rattaché" : "Client retiré");
  const c = card.data;
  return (
    <Modal open={open} onClose={onClose} title={customerId ? "Client de la commande" : "Rattacher un client"} size="md">
      {customerId ? (card.isLoading || !c ? <div className="flex justify-center py-8"><Spinner /></div> : (
        <div className="space-y-3">
          <div className="rounded-2xl surface-2 p-4">
            <p className="text-lg font-extrabold">{c.firstName} {c.lastName}</p>
            <p className="text-sm text-muted">{[c.phone, c.email].filter(Boolean).join(" · ")}</p>
            {c.allergies ? <p className="mt-1 text-sm font-semibold text-corail-500">⚠ {c.allergies}</p> : null}
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div><p className="text-[11px] font-bold uppercase text-muted">Visites</p><p className="text-xl font-extrabold">{c.visitCount}</p></div>
              <div><p className="text-[11px] font-bold uppercase text-muted">Dépensé</p><p className="text-xl font-extrabold"><Money amount={c.totalSpent} /></p></div>
              <div><p className="text-[11px] font-bold uppercase text-muted">Points</p><p className="text-xl font-extrabold text-brand">{c.points}</p></div>
            </div>
          </div>
          {c.settings.enabled ? (
            <div className="rounded-2xl border border-line p-3 text-sm">
              <p className="font-semibold">Fidélité : {c.settings.pointsPer100} pt / 100 F · récompense de <Money amount={c.settings.rewardValue} /> tous les {c.settings.rewardPoints} pts</p>
              {c.rewardsAvailable > 0 ? <p className="mt-1"><Badge color="green">{c.rewardsAvailable} récompense{c.rewardsAvailable > 1 ? "s" : ""} disponible{c.rewardsAvailable > 1 ? "s" : ""}</Badge></p> : <p className="mt-1 text-xs text-muted">Encore {c.settings.rewardPoints - (c.points % c.settings.rewardPoints)} pts avant la prochaine récompense</p>}
              {!closed && c.rewardsAvailable > 0 ? <Button className="mt-2 w-full" variant="accent" loading={busy} onClick={() => run(() => api.post(`/api/orders/${orderId}/loyalty`, { rewards: 1 }), "Récompense appliquée en remise")}>Utiliser une récompense (−<Money amount={c.settings.rewardValue} />)</Button> : null}
            </div>
          ) : <p className="text-xs text-muted">Programme de fidélité désactivé (Administration → Digital).</p>}
          {c.transactions.length ? <ul className="max-h-40 overflow-y-auto text-xs text-muted">{c.transactions.map((t) => <li key={t.id} className="flex justify-between border-b border-line py-1"><span>{t.reason}</span><span className={t.points < 0 ? "text-red-600" : "text-green-600"}>{t.points > 0 ? "+" : ""}{t.points}</span></li>)}</ul> : null}
          {!closed ? <Button variant="ghost" className="w-full" loading={busy} onClick={() => attach(null)}>Retirer le client de la commande</Button> : null}
        </div>
      )) : (
        <div className="space-y-3">
          {!create ? <>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nom, téléphone ou email…" autoFocus />
            {results.isFetching ? <Spinner /> : null}
            <div className="max-h-64 space-y-1 overflow-y-auto">{results.data?.map((r) => <button key={r.id} onClick={() => attach(r.id)} className="touch flex w-full items-center justify-between rounded-xl surface-2 px-3 py-2 text-left text-sm hover:surface-3"><span><span className="font-bold">{r.firstName} {r.lastName}</span><span className="block text-xs text-muted">{[r.phone, r.email].filter(Boolean).join(" · ")}</span></span><span className="text-xs text-muted">{r.visitCount} visites · {r.points} pts</span></button>)}{results.data?.length === 0 ? <p className="py-3 text-center text-sm text-muted">Aucun client trouvé</p> : null}</div>
            <Button variant="secondary" className="w-full" onClick={() => setCreate({ firstName: "", lastName: search, phone: /^\+?[\d\s]+$/.test(search) ? search : "", email: "" })}>+ Nouveau client</Button>
          </> : <>
            <div className="grid grid-cols-2 gap-2"><Field label="Prénom"><Input value={create.firstName} onChange={(e) => setCreate({ ...create, firstName: e.target.value })} /></Field><Field label="Nom"><Input value={create.lastName} onChange={(e) => setCreate({ ...create, lastName: e.target.value })} /></Field><Field label="Téléphone"><Input value={create.phone} onChange={(e) => setCreate({ ...create, phone: e.target.value })} /></Field><Field label="Email"><Input value={create.email} onChange={(e) => setCreate({ ...create, email: e.target.value })} /></Field></div>
            <div className="flex gap-2"><Button variant="ghost" onClick={() => setCreate(null)}>Retour</Button><Button className="flex-1" loading={busy} disabled={!create.firstName && !create.lastName && !create.phone} onClick={() => run(async () => { const c = await api.post<{ id: string }>("/api/customers", { firstName: create.firstName || null, lastName: create.lastName || null, phone: create.phone || null, email: create.email || null }); await api.post(`/api/orders/${orderId}/customer`, { customerId: c.id }); }, "Client créé et rattaché")}>Créer et rattacher</Button></div>
          </>}
        </div>
      )}
    </Modal>
  );
}
