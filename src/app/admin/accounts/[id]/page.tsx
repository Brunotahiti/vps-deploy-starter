"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Banknote, FileText, Mail, Pencil, Receipt } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { PageHeader, useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge, Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { AccountForm, SETTLEMENT_LABEL, type AccountRow } from "@/components/admin/accounts";
import { formatDate, formatDateTime } from "@/lib/dates";

type Detail = {
  account: AccountRow; balance: number; charged: number; settled: number; credit: number; uninvoiced: number;
  charges: { id: string; at: string; orderId: string; orderNumber: string; amount: number; refunded: number; invoiceNumber: string | null; label: string | null }[];
  settlements: { id: string; at: string; amount: number; method: string; reference: string | null; note: string | null }[];
  invoices: { id: string; number: string; issuedAt: string; dueAt: string; totalTtc: number; totalTax: number; paid: number; remaining: number; status: "PAID" | "OVERDUE" | "ISSUED"; remindedAt: string | null; reminderCount: number }[];
};
const STATUS: Record<Detail["invoices"][number]["status"], { label: string; color: "green" | "red" | "orange" }> = { PAID: { label: "Réglée", color: "green" }, OVERDUE: { label: "En retard", color: "red" }, ISSUED: { label: "À régler", color: "orange" } };

/** Fiche d'un compte client pro : encours, facturer, encaisser un règlement, relancer. */
export default function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const act = useAction();
  const { timezone } = useSession();
  const q = useQuery({ queryKey: ["accounts", "detail", id], queryFn: () => api.get<Detail>(`/api/accounts/${id}`) });
  const [edit, setEdit] = useState(false);
  const [settle, setSettle] = useState<{ amount: string; method: string; reference: string } | null>(null);
  if (q.isLoading || !q.data) return <Spinner />;
  const d = q.data, a = d.account;
  const invalidate = [["accounts"]];
  const invoice = () => act(() => api.post<{ id: string; number: string }>(`/api/accounts/${id}/invoices`, {}), { success: "Facture émise", invalidate }).then((r) => { if (r) window.open(`/api/accounts/invoices/${r.id}/pdf`, "_blank", "noopener"); });
  const remind = (inv: Detail["invoices"][number]) => act(() => api.post(`/api/accounts/invoices/${inv.id}/remind`), { success: `Relance envoyée à ${a.email}`, invalidate });
  const amount = settle ? Number(settle.amount.replace(/\s/g, "")) : 0;
  const saveSettlement = async () => {
    if (!settle || !Number.isInteger(amount) || amount <= 0) return;
    const r = await act(() => api.post(`/api/accounts/${id}/settlements`, { amount, method: settle.method, reference: settle.reference || null }), { success: "Règlement enregistré", invalidate });
    if (r) setSettle(null);
  };
  // Opérations : consommations et règlements, les plus récentes d'abord
  const ops = [...d.charges.map((c) => ({ kind: "charge" as const, at: c.at, c })), ...d.settlements.map((s) => ({ kind: "settlement" as const, at: s.at, s }))].sort((x, y) => y.at.localeCompare(x.at));

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/accounts" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-[var(--text)]"><ArrowLeft className="h-4 w-4" />Comptes clients</Link>
      <PageHeader title={a.name} subtitle={[a.contactName, a.tahitiNumber ? `N° Tahiti ${a.tahitiNumber}` : null, a.email, a.phone].filter(Boolean).join(" · ") || undefined}
        action={<Button variant="secondary" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" />Modifier</Button>} />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4"><p className="text-xs uppercase text-muted">Encours</p><p className="text-2xl font-extrabold" data-testid="account-balance"><Money amount={d.balance} /></p>{a.creditLimit !== null ? <p className="text-xs text-muted">plafond <Money amount={a.creditLimit} /></p> : null}</div>
        <div className="card p-4"><p className="text-xs uppercase text-muted">À facturer</p><p className="text-2xl font-extrabold"><Money amount={d.uninvoiced} /></p></div>
        <div className="card p-4"><p className="text-xs uppercase text-muted">Réglé au total</p><p className="text-2xl font-extrabold"><Money amount={d.settled} /></p>{d.credit ? <p className="text-xs text-green-700">dont avance <Money amount={d.credit} /></p> : null}</div>
        <div className="card p-4"><p className="text-xs uppercase text-muted">Délai</p><p className="text-2xl font-extrabold">{a.paymentTermsDays ? `${a.paymentTermsDays} j` : "Réception"}</p></div>
      </div>
      <div className="mb-6 flex flex-wrap gap-2">
        <Button size="lg" onClick={invoice} disabled={d.uninvoiced <= 0} data-testid="account-invoice"><Receipt className="h-5 w-5" />Facturer <Money amount={d.uninvoiced} /></Button>
        <Button size="lg" variant="secondary" onClick={() => setSettle({ amount: d.balance > 0 ? String(d.balance) : "", method: "TRANSFER", reference: "" })} data-testid="account-settle"><Banknote className="h-5 w-5" />Enregistrer un règlement</Button>
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-extrabold">Factures</h2>
        {d.invoices.length ? (
          <ul className="card divide-y divide-[var(--border)]">
            {d.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="invoice-row">
                <FileText className="h-5 w-5 shrink-0 text-lagon-600" />
                <div className="min-w-0 flex-1 basis-40">
                  <p className="font-bold">{i.number} <span className="ml-1"><Badge color={STATUS[i.status].color}>{STATUS[i.status].label}</Badge></span></p>
                  <p className="text-xs text-muted">Émise le {formatDate(i.issuedAt, timezone)} · échéance {formatDate(i.dueAt, timezone)}{i.reminderCount ? ` · relancée ${i.reminderCount} fois, le ${formatDate(i.remindedAt!, timezone)}` : ""}</p>
                </div>
                <div className="text-right text-sm"><p className="font-extrabold"><Money amount={i.totalTtc} /></p>{i.remaining && i.paid ? <p className="text-xs text-muted">reste <Money amount={i.remaining} /></p> : null}</div>
                <div className="flex gap-1.5">
                  <a href={`/api/accounts/invoices/${i.id}/pdf`} target="_blank" rel="noopener" className="touch inline-flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-sm font-semibold hover:surface-2"><FileText className="h-4 w-4" />PDF</a>
                  {i.status !== "PAID" && a.email ? <Button size="sm" variant="secondary" onClick={() => remind(i)} aria-label={`Relancer ${i.number}`}><Mail className="h-4 w-4" />Relancer</Button> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Aucune facture pour l&apos;instant.</p>}
      </section>

      <section>
        <h2 className="mb-2 text-base font-extrabold">Opérations</h2>
        {ops.length ? (
          <ul className="card divide-y divide-[var(--border)]">
            {ops.map((o) => o.kind === "charge" ? (
              <li key={o.c.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1"><p className="font-semibold">Commande {o.c.orderNumber}{o.c.label ? ` · ${o.c.label}` : ""}</p><p className="text-xs text-muted">{formatDateTime(o.at, timezone)}{o.c.invoiceNumber ? ` · facture ${o.c.invoiceNumber}` : " · à facturer"}{o.c.refunded ? " · remboursée en partie" : ""}</p></div>
                <span className="font-bold">+ <Money amount={o.c.amount} /></span>
              </li>
            ) : (
              <li key={o.s.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1"><p className="font-semibold text-green-700 dark:text-green-400">Règlement · {SETTLEMENT_LABEL[o.s.method] ?? o.s.method}{o.s.reference ? ` · ${o.s.reference}` : ""}</p><p className="text-xs text-muted">{formatDateTime(o.at, timezone)}</p></div>
                <span className="font-bold text-green-700 dark:text-green-400">− <Money amount={o.s.amount} /></span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Aucune opération : à la caisse, choisissez « Sur compte » au moment d&apos;encaisser.</p>}
      </section>

      {edit ? <AccountForm account={a} onClose={() => setEdit(false)} /> : null}
      {settle ? (
        <Modal open onClose={() => setSettle(null)} size="sm" title="Règlement reçu" footer={<Button size="lg" className="w-full" onClick={saveSettlement} disabled={!Number.isInteger(amount) || amount <= 0} data-testid="settlement-save">Enregistrer le règlement</Button>}>
          <div className="grid gap-3">
            <Field label="Montant (F CFP)"><Input inputMode="numeric" autoFocus value={settle.amount} onChange={(e) => setSettle({ ...settle, amount: e.target.value })} aria-label="Montant du règlement" /></Field>
            <Field label="Moyen"><Select value={settle.method} onChange={(e) => setSettle({ ...settle, method: e.target.value })} aria-label="Moyen de règlement">{Object.entries(SETTLEMENT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Référence (n° de chèque, virement…)"><Input value={settle.reference} onChange={(e) => setSettle({ ...settle, reference: e.target.value })} aria-label="Référence" /></Field>
            <p className="text-xs text-muted">Le règlement solde d&apos;abord les factures les plus anciennes.{settle.method === "CASH" ? " En espèces, il entre dans la caisse ouverte." : ""}</p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
