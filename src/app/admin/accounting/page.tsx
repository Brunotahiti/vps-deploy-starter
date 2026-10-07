"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea, Toggle } from "@/components/ui/field";
import { Spinner, Card, Badge, Empty } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { formatMoney } from "@/lib/money";
import { addDays, formatDate, localDay } from "@/lib/dates";
import { PageHeader, Table, Tr, Td, useAction, useList } from "@/components/admin/common";
import { Stat, HBars } from "@/components/admin/charts";
import { PAYMENT_LABEL } from "@/components/pos/types";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_KEYS, EXPENSE_METHODS } from "@/lib/accounting";
import type { AccountingSummary, listExpenses } from "@/server/services/accounting";
import type { listSuppliers } from "@/server/services/stock";

type Expense = Awaited<ReturnType<typeof listExpenses>>[number];
type Supplier = Awaited<ReturnType<typeof listSuppliers>>[number];
type Form = { id?: string; date: string; label: string; category: string; supplierId: string; supplierName: string; reference: string; amountTtc: string; taxAmount: string; paid: boolean; method: string; paidAt: string; notes: string };

const PRESETS: [string, (t: string) => [string, string]][] = [
  ["Ce mois", (t) => [t.slice(0, 8) + "01", t]], ["Mois dernier", (t) => { const first = t.slice(0, 8) + "01"; const lastPrev = addDays(first, -1); return [lastPrev.slice(0, 8) + "01", lastPrev]; }],
  ["Trimestre", (t) => { const m = Number(t.slice(5, 7)); const qm = String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0"); return [`${t.slice(0, 4)}-${qm}-01`, t]; }], ["Année", (t) => [t.slice(0, 4) + "-01-01", t]],
];
/** TVA sur une dépense à partir du TTC et d'un taux (Polynésie : 5 %, 13 %, 16 %). */
const taxFromTtc = (ttc: number, rateBps: number) => Math.round(ttc - ttc / (1 + rateBps / 10000));

/**
 * Comptabilité : ventes et TVA (depuis la caisse), achats (depuis le stock), dépenses saisies, personnel,
 * résultat estimé et exports pour le comptable.
 */
export default function AccountingPage() {
  const { can, hasOption, currency, timezone } = useSession();
  const act = useAction();
  const today = localDay(new Date(), timezone);
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const allowed = can("reports.view") && hasOption("stats");
  const sum = useList<AccountingSummary>(["accounting", "summary", from, to], `/api/accounting/summary?from=${from}&to=${to}`, allowed);
  const expenses = useList<Expense[]>(["accounting", "expenses", from, to], `/api/accounting/expenses?from=${from}&to=${to}`, allowed);
  const suppliers = useList<Supplier[]>(["stock", "suppliers"], "/api/suppliers", allowed && hasOption("stock"));
  const [edit, setEdit] = useState<Form | null>(null);
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);
  if (!allowed) return <Empty title="Comptabilité" hint="Réservée aux profils qui consultent les rapports, avec l'option Statistiques & rapports (Gestion → Options)." />;
  const d = sum.data;
  const blank = (): Form => ({ date: today, label: "", category: "SUPPLIES", supplierId: "", supplierName: "", reference: "", amountTtc: "", taxAmount: "0", paid: true, method: "TRANSFER", paidAt: today, notes: "" });
  const toForm = (e: Expense): Form => ({ id: e.id, date: localDay(new Date(e.date), timezone), label: e.label, category: e.category, supplierId: e.supplierId ?? "", supplierName: e.supplierName ?? "", reference: e.reference ?? "", amountTtc: String(e.amountTtc), taxAmount: String(e.taxAmount), paid: !!e.method, method: e.method ?? "TRANSFER", paidAt: e.paidAt ? localDay(new Date(e.paidAt), timezone) : today, notes: e.notes ?? "" });
  const save = async () => {
    if (!edit) return;
    const body = { date: edit.date, label: edit.label, category: edit.category, supplierId: edit.supplierId || null, supplierName: edit.supplierName || null, reference: edit.reference || null, amountTtc: Number(edit.amountTtc), taxAmount: Number(edit.taxAmount || 0), method: edit.paid ? edit.method : null, paidAt: edit.paid ? edit.paidAt : null, notes: edit.notes || null };
    const r = await act(() => (edit.id ? api.patch(`/api/accounting/expenses/${edit.id}`, body) : api.post("/api/accounting/expenses", body)), { success: "Dépense enregistrée", invalidate: [["accounting"]] });
    if (r) setEdit(null);
  };
  const remove = (e: Expense) => confirm(`Supprimer la dépense « ${e.label} » ?`) && act(() => api.delete(`/api/accounting/expenses/${e.id}`), { success: "Dépense supprimée", invalidate: [["accounting"]] });
  const exp = (type: string, format: string) => `/api/reports/export?type=${type}&format=${format}&from=${from}&to=${to}`;
  const rows = (expenses.data ?? []).filter((e) => !onlyUnpaid || !e.paid);

  return (
    <div>
      <PageHeader title="Comptabilité" subtitle="Ventes et TVA depuis la caisse, achats depuis le stock, dépenses à saisir ici : le résultat et les exports pour votre comptable" action={
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map(([label, fn]) => <button key={label} onClick={() => { const [f, t] = fn(today); setFrom(f); setTo(t); }} className="touch h-10 rounded-lg surface-2 px-3 text-xs font-bold">{label}</button>)}
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40!" /><span>→</span><Input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="w-40!" />
        </div>
      } />
      {sum.isLoading || !d ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Ventes HT" value={<Money amount={d.result.revenueHt} />} hint={`TTC ${formatMoney(d.sales.netTtc, currency)} · ${d.sales.tickets} tickets`} accent="#14aaa3" />
            <Stat label="TVA à reverser" value={<Money amount={d.vat.due} />} hint={`collectée ${formatMoney(d.vat.collected, currency)} − déductible ${formatMoney(d.vat.deductible, currency)}`} accent="#8b5cf6" />
            <Stat label="Achats matières" value={<Money amount={d.result.purchases} />} hint={d.result.foodCostPct !== null ? `${d.result.foodCostPct} % des ventes HT · depuis le stock` : "réceptions et achats en stock"} accent="#f97316" />
            <Stat label="Dépenses HT" value={<Money amount={d.result.expensesHt} />} hint={d.expenses.unpaid ? `${formatMoney(d.expenses.unpaid, currency)} encore à payer` : `${d.expenses.count} dépense${d.expenses.count > 1 ? "s" : ""} saisie${d.expenses.count > 1 ? "s" : ""}`} accent="#3b82f6" />
            <Stat label="Personnel pointé" value={d.staff.laborCost !== null ? <Money amount={d.staff.laborCost} /> : "—"} hint={d.staff.laborCost === null ? "option Équipe" : d.expenses.staffHt ? `+ ${formatMoney(d.expenses.staffHt, currency)} saisis en dépenses` : "heures × coût horaire"} accent="#ec4899" />
            <Stat label="Résultat estimé" value={<Money amount={d.result.result} />} hint={d.result.marginPct !== null ? `${d.result.marginPct} % des ventes HT` : undefined} accent={d.result.result >= 0 ? "#22c55e" : "#ef4444"} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_320px]">
            <Card title="Ventes par taux de TVA">
              <Table head={["Taux", "HT", "TVA", "TTC"]}>
                {d.sales.byRate.map((r) => <Tr key={`${r.rateBps}-${r.name}`}><Td className="font-semibold">{r.name}</Td><Td><Money amount={r.ht} /></Td><Td><Money amount={r.tax} /></Td><Td><Money amount={r.ttc} /></Td></Tr>)}
                {d.sales.refundsTtc ? <Tr><Td className="text-muted">Remboursements</Td><Td className="text-red-600">−<Money amount={d.sales.refundsTtc - d.sales.refundsTax} /></Td><Td className="text-red-600">−<Money amount={d.sales.refundsTax} /></Td><Td className="text-red-600">−<Money amount={d.sales.refundsTtc} /></Td></Tr> : null}
                <Tr><Td className="font-extrabold">Total</Td><Td className="font-extrabold"><Money amount={d.result.revenueHt} /></Td><Td className="font-extrabold"><Money amount={d.vat.collected} /></Td><Td className="font-extrabold"><Money amount={d.sales.netTtc} /></Td></Tr>
              </Table>
              {d.sales.discounts ? <p className="mt-2 text-xs text-muted">Remises accordées : {formatMoney(d.sales.discounts, currency)}{d.sales.tips ? ` · pourboires ${formatMoney(d.sales.tips, currency)}` : ""}</p> : null}
            </Card>
            <Card title="Encaissements">
              <HBars data={d.receipts.map((m) => ({ label: PAYMENT_LABEL[m.method] ?? m.method, value: m.amount, hint: `× ${m.count}` }))} currency={currency} color="#3b82f6" />
              {d.cashOut.total ? <p className="mt-3 border-t border-line pt-2 text-xs text-muted">Sorties d&apos;espèces de la caisse : {formatMoney(d.cashOut.total, currency)} ({d.cashOut.count}). Saisissez-les en dépenses pour les retrouver dans le résultat.</p> : null}
            </Card>
            <Card title="Exports pour le comptable">
              <ExportRow label="Export comptable complet" hint="Résultat, ventes par TVA, encaissements, remboursements, dépenses, achats, écritures" exp={(f) => exp("accounting", f)} />
              <ExportRow label="Dépenses" hint="La liste des dépenses saisies" exp={(f) => exp("expenses", f)} />
              <ExportRow label="Rapport de période" hint="Ventes détaillées" exp={(f) => exp("period", f)} />
              {can("orders.view_history") ? <ExportRow label="Liste des commandes" exp={(f) => exp("orders", f)} /> : null}
              {hasOption("stock") && can("stock.view") ? <ExportRow label="Stock (valorisation et mouvements)" exp={(f) => exp("stock", f)} /> : null}
              <p className="mt-2 text-xs text-muted">CSV (séparateur « ; »), classeur Excel, PDF A4. Les écritures (707 / 4457 / 53 / 512 / 401 / 6xx) s&apos;importent dans la plupart des logiciels comptables.</p>
            </Card>
          </div>

          <Card title={`Dépenses (${d.expenses.count})`} action={<div className="flex items-center gap-3"><Toggle checked={onlyUnpaid} onChange={setOnlyUnpaid} label="À payer seulement" /><Button size="sm" onClick={() => setEdit(blank())} data-testid="expense-new"><Plus className="h-4 w-4" />Nouvelle dépense</Button></div>}>
            {d.expenses.byCategory.length ? <div className="mb-4"><HBars data={d.expenses.byCategory.map((c) => ({ label: c.label, value: c.ttc, hint: `HT ${formatMoney(c.ht, currency)} · TVA ${formatMoney(c.tax, currency)}` }))} currency={currency} color="#f97316" /></div> : null}
            {expenses.isLoading ? <div className="flex justify-center py-6"><Spinner /></div> : rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">{d.expenses.count ? "Toutes les dépenses de la période sont payées." : "Aucune dépense saisie sur la période. Loyer, électricité, factures de fournisseurs hors bons de commande, assurances… : saisissez-les ici pour un résultat et une TVA complets."}</p>
            ) : (
              <Table head={["Date", "Libellé", "Catégorie", "Fournisseur", "TTC", "TVA", "HT", "Paiement", ""]}>
                {rows.map((e) => (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDate(e.date, timezone)}</Td>
                    <Td><span className="font-semibold">{e.label}</span>{e.reference ? <span className="block text-xs text-muted">{e.reference}</span> : null}</Td>
                    <Td className="text-xs">{e.categoryLabel}<span className="block font-mono text-[10px] text-muted">{e.account}</span></Td>
                    <Td className="text-xs">{e.supplierName ?? e.supplier?.name ?? "—"}</Td>
                    <Td className="font-semibold tabular-nums"><Money amount={e.amountTtc} /></Td><Td className="tabular-nums"><Money amount={e.taxAmount} /></Td><Td className="tabular-nums"><Money amount={e.amountHt} /></Td>
                    <Td>{e.method ? <Badge color="green">{PAYMENT_LABEL[e.method] ?? e.method}</Badge> : <Badge color="orange">à payer</Badge>}</Td>
                    <Td className="space-x-3 whitespace-nowrap"><button onClick={() => setEdit(toForm(e))} className="text-xs font-semibold text-lagon-600">Modifier</button><button onClick={() => remove(e)} className="text-xs font-semibold text-red-600">Supprimer</button></Td>
                  </Tr>
                ))}
              </Table>
            )}
          </Card>
          <p className="text-xs text-muted">Les achats reçus par bon de commande ou saisis dans le stock sont déjà comptés en « Achats matières » : ne les ressaisissez pas en dépense. Le résultat est une estimation d&apos;exploitation (hors amortissements, emprunts et impôt sur les bénéfices) ; votre comptable établit les comptes officiels à partir des exports.</p>
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier la dépense" : "Nouvelle dépense"} size="lg" footer={<Button className="w-full" disabled={!edit?.label || !edit?.date || !(Number(edit?.amountTtc) > 0) || Number(edit?.taxAmount || 0) > Number(edit?.amountTtc || 0)} onClick={save} data-testid="expense-save">Enregistrer</Button>}>
        {edit ? <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date de la pièce"><Input type="date" value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} /></Field>
          <Field label="Catégorie" hint={EXPENSE_CATEGORIES[edit.category as keyof typeof EXPENSE_CATEGORIES]?.hint}><Select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>{EXPENSE_CATEGORY_KEYS.map((k) => <option key={k} value={k}>{EXPENSE_CATEGORIES[k].label}</option>)}</Select></Field>
          <Field label="Libellé" className="sm:col-span-2"><Input value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="Loyer octobre, Facture EDT, Barquettes…" autoFocus data-testid="expense-label" /></Field>
          <Field label="Montant TTC (F)"><Input type="number" inputMode="numeric" value={edit.amountTtc} onChange={(e) => setEdit({ ...edit, amountTtc: e.target.value })} data-testid="expense-amount" /></Field>
          <Field label="dont TVA déductible (F)" hint="Boutons : calcul depuis le TTC"><div className="flex gap-1"><Input type="number" inputMode="numeric" value={edit.taxAmount} onChange={(e) => setEdit({ ...edit, taxAmount: e.target.value })} />{[500, 1300, 1600].map((r) => <button key={r} type="button" onClick={() => setEdit({ ...edit, taxAmount: String(taxFromTtc(Number(edit.amountTtc || 0), r)) })} className="touch shrink-0 rounded-lg surface-2 px-2 text-xs font-bold">{r / 100} %</button>)}</div></Field>
          {suppliers.data?.length ? <Field label="Fournisseur (du stock)"><Select value={edit.supplierId} onChange={(e) => setEdit({ ...edit, supplierId: e.target.value, supplierName: e.target.value ? "" : edit.supplierName })}><option value="">—</option>{suppliers.data.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field> : null}
          <Field label={suppliers.data?.length ? "ou nom du fournisseur" : "Fournisseur"}><Input value={edit.supplierName} onChange={(e) => setEdit({ ...edit, supplierName: e.target.value, supplierId: e.target.value ? "" : edit.supplierId })} placeholder="EDT, OPT, propriétaire…" /></Field>
          <Field label="N° de facture / référence"><Input value={edit.reference} onChange={(e) => setEdit({ ...edit, reference: e.target.value })} /></Field>
          <div className="flex items-end"><Toggle checked={edit.paid} onChange={(v) => setEdit({ ...edit, paid: v })} label={edit.paid ? "Payée" : "À payer"} /></div>
          {edit.paid ? <><Field label="Moyen de paiement"><Select value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value })}>{EXPENSE_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_LABEL[m] ?? m}</option>)}</Select></Field><Field label="Payée le"><Input type="date" value={edit.paidAt} onChange={(e) => setEdit({ ...edit, paidAt: e.target.value })} /></Field></> : null}
          <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </div> : null}
      </Modal>
    </div>
  );
}

function ExportRow({ label, hint, exp }: { label: string; hint?: string; exp: (format: string) => string }) {
  return <div className="flex items-center justify-between gap-2 py-1.5 text-sm"><span className="min-w-0"><span className="block font-semibold">{label}</span>{hint ? <span className="block truncate text-[11px] text-muted">{hint}</span> : null}</span><span className="flex shrink-0 gap-1"><a href={exp("csv")} className="touch rounded-lg surface-2 px-2.5 py-1 text-xs font-bold">CSV</a><a href={exp("xlsx")} className="touch rounded-lg surface-2 px-2.5 py-1 text-xs font-bold">Excel</a><a href={exp("pdf")} target="_blank" rel="noreferrer" className="touch rounded-lg surface-2 px-2.5 py-1 text-xs font-bold">PDF</a></span></div>;
}
