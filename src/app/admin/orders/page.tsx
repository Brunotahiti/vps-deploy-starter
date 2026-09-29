"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { localDay, formatDateTime } from "@/lib/dates";
import { Spinner, Badge } from "@/components/ui/misc";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/money";
import { PageHeader, Table, Tr, Td, useAction } from "@/components/admin/common";
import { PinModal, withPin, type PinRequest } from "@/components/pos/pin-modal";
import { ORDER_STATUS_LABEL, ORDER_TYPE_LABEL, PAYMENT_LABEL, type Order } from "@/components/pos/types";

export default function OrdersAdmin() {
  const { timezone } = useSession();
  const [day, setDay] = useState(localDay(new Date(), timezone));
  const [status, setStatus] = useState("");
  const [sel, setSel] = useState<Order | null>(null);
  const [pin, setPin] = useState<PinRequest>(null);
  const [refund, setRefund] = useState<{ paymentId: string; amount: string; reason: string } | null>(null);
  const act = useAction();
  const q = useQuery({ queryKey: ["orders", "admin", day, status], queryFn: () => api.get<{ items: Order[]; total: number }>(`/api/orders?day=${day}${status ? `&status=${status}` : ""}&take=200`) });

  const doRefund = async () => {
    if (!refund) return;
    const r = await act(() => withPin(setPin, "pos.refund", (managerPin) => api.post<Order>(`/api/payments/${refund.paymentId}/refund`, { amount: Number(refund.amount), reason: refund.reason, managerPin })), { success: "Remboursement enregistré", invalidate: [["orders"], ["reports"], ["cash"]] });
    if (r) { setSel(r as Order); setRefund(null); }
  };

  return (
    <div>
      <PageHeader title="Commandes" subtitle="Historique, tickets et remboursements" action={
        <div className="flex gap-2"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-10 rounded-lg border border-line surface px-2 text-sm" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-lg border border-line surface px-2 text-sm"><option value="">Tous statuts</option>{Object.entries(ORDER_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      } />
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : (
        <Table head={["N°", "Heure", "Type / table", "Serveur", "Articles", "Statut", "Total", "Payé"]}>
          {q.data?.items.map((o) => (
            <Tr key={o.id} onClick={() => setSel(o)}>
              <Td className="font-mono text-xs">{o.number}</Td><Td>{formatDateTime(o.openedAt, timezone)}</Td><Td>{o.table ? `Table ${o.table.name}` : ORDER_TYPE_LABEL[o.type]}{o.customerName ? ` · ${o.customerName}` : ""}</Td><Td>{o.server?.displayName || o.server?.firstName}</Td><Td>{o.items.filter((i) => i.status !== "VOIDED" && !i.parentItemId).length}</Td>
              <Td><Badge color={o.status === "PAID" ? "green" : o.status === "CANCELLED" ? "red" : "orange"}>{ORDER_STATUS_LABEL[o.status]}</Badge></Td><Td className="font-semibold"><Money amount={o.total} /></Td><Td><Money amount={o.paidTotal} /></Td>
            </Tr>
          ))}
          {q.data?.items.length === 0 ? <Tr><Td className="py-8 text-center text-muted">Aucune commande ce jour</Td></Tr> : null}
        </Table>
      )}
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `Commande ${sel.number}` : ""} size="lg">
        {sel ? (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2"><Badge color={sel.status === "PAID" ? "green" : sel.status === "CANCELLED" ? "red" : "orange"}>{ORDER_STATUS_LABEL[sel.status]}</Badge><span>{sel.table ? `Table ${sel.table.name}` : ORDER_TYPE_LABEL[sel.type]} · {sel.covers} couverts · {sel.server?.displayName || sel.server?.firstName}</span>{sel.cancelReason ? <span className="text-red-600">Motif : {sel.cancelReason}</span> : null}</div>
            <div className="rounded-xl border border-line">{sel.items.filter((i) => !i.parentItemId).map((i) => <div key={i.id} className={`flex justify-between border-b border-line px-3 py-1.5 last:border-0 ${i.status === "VOIDED" ? "line-through opacity-50" : ""}`}><span>{i.quantity} × {i.name}{i.modifiers.length ? <span className="text-muted"> ({i.modifiers.map((m) => m.name).join(", ")})</span> : null}{i.voidReason ? <span className="text-red-600"> — {i.voidReason}</span> : null}</span><Money amount={i.lineTotal} /></div>)}</div>
            <div className="flex justify-between font-bold"><span>Total {sel.discountTotal ? <span className="font-normal text-muted">(remise {sel.discountTotal} · {sel.discountReason})</span> : null}</span><Money amount={sel.total} /></div>
            <div>
              <p className="mb-1 text-xs font-bold uppercase text-muted">Paiements</p>
              {sel.payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between border-b border-line py-1.5 last:border-0">
                  <span>{PAYMENT_LABEL[p.method]}{p.splitLabel ? ` · ${p.splitLabel}` : ""}{p.tipAmount ? ` · pourboire ${p.tipAmount}` : ""}{p.refundedAmount ? <span className="text-red-600"> · remboursé <Money amount={p.refundedAmount} /></span> : null}</span>
                  <span className="flex items-center gap-2"><Money amount={p.amount} />{p.amount - p.refundedAmount > 0 ? <Button size="sm" variant="outline" onClick={() => setRefund({ paymentId: p.id, amount: String(p.amount - p.refundedAmount), reason: "" })}>Rembourser</Button> : null}</span>
                </div>
              ))}
              {sel.payments.length === 0 ? <p className="text-muted">Aucun paiement</p> : null}
            </div>
            <div className="flex gap-2"><a className="touch inline-flex h-10 items-center rounded-lg surface-2 px-3 font-semibold" href={`/api/orders/${sel.id}/receipt`} target="_blank" rel="noreferrer">Ticket HTML</a><a className="touch inline-flex h-10 items-center rounded-lg surface-2 px-3 font-semibold" href={`/api/orders/${sel.id}/receipt?format=pdf`} target="_blank" rel="noreferrer">Ticket PDF</a></div>
          </div>
        ) : null}
      </Modal>
      <Modal open={!!refund} onClose={() => setRefund(null)} title="Rembourser" size="sm">
        {refund ? <div className="space-y-3"><label className="block text-xs font-bold uppercase text-muted">Montant<input type="number" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} className="mt-1 h-11 w-full rounded-xl border border-line surface px-3 text-sm" /></label><label className="block text-xs font-bold uppercase text-muted">Motif<input value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} className="mt-1 h-11 w-full rounded-xl border border-line surface px-3 text-sm" /></label><Button variant="danger" className="w-full" disabled={!refund.reason || Number(refund.amount) <= 0} onClick={doRefund}>Confirmer le remboursement</Button></div> : null}
      </Modal>
      <PinModal request={pin} onClose={() => setPin(null)} />
    </div>
  );
}
