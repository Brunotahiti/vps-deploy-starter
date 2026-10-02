"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Banknote, Check, ChefHat, Copy, FileText, Lock, Mail, MapPin, Pencil, Plus, Receipt, Send, Trash2, Undo2, Users, XCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { PageHeader, useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select } from "@/components/ui/field";
import { Badge, Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { useToast } from "@/components/ui/toast";
import { EventForm, type EventDetail } from "@/components/admin/catering";
import { CATERING_METHODS, EVENT_KINDS, EVENT_STATUS, eventTotals, type CateringMethod, type EventLine } from "@/lib/catering";
import { formatDate, formatDateTime, formatTime } from "@/lib/dates";

type Catalog = { products: { id: string; name: string; category: string | null; priceTtc: number; taxRateBps: number; taxRateName: string | null }[]; taxRates: { name: string; rateBps: number; isDefault: boolean }[] };
type LineDraft = { label: string; quantity: string; unitPrice: string; taxRateBps: number; taxRateName: string | null };
const STEPS = [["DRAFT", "Devis"], ["SENT", "Envoyé"], ["ACCEPTED", "Confirmé"], ["INVOICED", "Facturé"]] as const;
const KIND_LABEL = { DEPOSIT: "Acompte", BALANCE: "Règlement", REFUND: "Remboursement" } as const;
const num = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));
const toDraft = (l: EventLine): LineDraft => ({ label: l.label, quantity: String(l.quantity).replace(".", ","), unitPrice: String(l.unitPrice), taxRateBps: l.taxRateBps, taxRateName: l.taxRateName });

/** Fiche d'un événement : devis (lignes depuis la carte), envoi, confirmation, acomptes, facture, fiche cuisine. */
export default function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const act = useAction();
  const { toast } = useToast();
  const { timezone } = useSession();
  const q = useQuery({ queryKey: ["catering", "detail", id], queryFn: () => api.get<EventDetail>(`/api/catering/${id}`) });
  const catalogQ = useQuery({ queryKey: ["catering", "catalog"], queryFn: () => api.get<Catalog>("/api/catering/catalog"), staleTime: 300_000 });
  const [lines, setLines] = useState<LineDraft[] | null>(null);
  const [deposit, setDeposit] = useState("");
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState<{ amount: string; method: CateringMethod; reference: string; refund: boolean } | null>(null);
  const [cancel, setCancel] = useState<string | null>(null);
  const [invoicing, setInvoicing] = useState<string | null>(null);
  const e = q.data;
  // Lignes éditées localement, remises à jour à chaque rechargement de la fiche
  // (seulement si le devis a changé côté serveur : un simple rafraîchissement n'efface pas la saisie en cours)
  const [synced, setSynced] = useState("");
  const serverKey = e ? JSON.stringify([e.lines, e.depositAmount]) : "";
  if (e && serverKey !== synced) { setSynced(serverKey); setLines(e.lines.map(toDraft)); setDeposit(e.depositAmount ? String(e.depositAmount) : ""); }
  const parsed = useMemo(() => (lines ?? []).map((l) => ({ label: l.label.trim(), quantity: num(l.quantity), unitPrice: num(l.unitPrice), taxRateBps: l.taxRateBps, taxRateName: l.taxRateName })), [lines]);
  if (q.isLoading || !e || !lines) return <Spinner />;

  const locked = e.status === "INVOICED" || e.status === "CANCELLED";
  const linesValid = parsed.every((l) => l.label && Number.isFinite(l.quantity) && l.quantity > 0 && Number.isInteger(l.quantity * 2) && Number.isInteger(l.unitPrice) && l.unitPrice >= 0);
  const depositN = deposit.trim() ? num(deposit) : 0;
  const totals = eventTotals(linesValid ? parsed : []);
  const dirty = JSON.stringify(parsed) !== JSON.stringify(e.lines.map((l) => ({ ...l, taxRateName: l.taxRateName }))) || depositN !== e.depositAmount;
  const invalidate = [["catering"]];
  const defaultRate = catalogQ.data?.taxRates.find((t) => t.isDefault) ?? catalogQ.data?.taxRates[0];

  const saveLines = () => act(() => api.patch(`/api/catering/${id}`, { lines: parsed, depositAmount: depositN }), { success: e.status === "SENT" ? "Devis modifié : renvoyez-le au client" : "Devis enregistré", invalidate });
  const send = (email: boolean) => act(() => api.post(`/api/catering/${id}/send`, { email }), { success: email ? `Devis envoyé à ${e.clientEmail}` : "Devis marqué comme remis au client", invalidate });
  const accept = () => act(() => api.post(`/api/catering/${id}/accept`), { success: "Événement confirmé", invalidate });
  const copyLink = async () => { await navigator.clipboard?.writeText(`${window.location.origin}/devis/${e.publicToken}`).catch(() => null); toast("Lien du devis copié : le client peut l'ouvrir et l'accepter en ligne", "success"); };
  const remove = async () => { if (await act(() => api.delete(`/api/catering/${id}`), { success: "Brouillon supprimé", invalidate })) router.push("/admin/catering"); };
  const payAmount = pay ? num(pay.amount) : 0;
  const savePay = async () => {
    if (!pay || !Number.isInteger(payAmount) || payAmount <= 0) return;
    const r = await act(() => api.post(`/api/catering/${id}/payments`, { amount: payAmount, method: pay.method, reference: pay.reference || null, refund: pay.refund }), { success: pay.refund ? "Remboursement enregistré" : "Paiement enregistré", invalidate });
    if (r) setPay(null);
  };
  const saveCancel = async () => { if (!cancel?.trim()) return; if (await act(() => api.post(`/api/catering/${id}/cancel`, { reason: cancel }), { success: "Événement annulé", invalidate })) setCancel(null); };
  const saveInvoice = async () => {
    const r = await act(() => api.post(`/api/catering/${id}/invoice`, { dueDays: Number(invoicing ?? 0) }), { success: "Facture émise", invalidate });
    if (r) { setInvoicing(null); window.open(`/api/catering/${id}/pdf?doc=invoice`, "_blank", "noopener"); }
  };
  const addProduct = (pid: string) => {
    const p = catalogQ.data?.products.find((x) => x.id === pid);
    if (p) setLines([...lines, { label: p.name, quantity: String(e.guests), unitPrice: String(p.priceTtc), taxRateBps: p.taxRateBps, taxRateName: p.taxRateName }]);
  };
  const setLine = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const step = STEPS.findIndex(([s]) => s === e.status);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/catering" className="mb-2 inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-[var(--text)]"><ArrowLeft className="h-4 w-4" />Traiteur & événements</Link>
      <PageHeader title={e.title} subtitle={`${EVENT_KINDS[e.kind]} · ${formatDate(e.startsAt, timezone)}, ${formatTime(e.startsAt, timezone)} – ${formatTime(e.endsAt, timezone)}`}
        action={!locked ? <Button variant="secondary" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" />Modifier</Button> : undefined} />

      {/* Parcours */}
      {e.status === "CANCELLED" ? (
        <div className="mb-4 flex items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-700 dark:text-red-300" data-testid="event-status"><XCircle className="h-5 w-5" />Annulé le {formatDate(e.cancelledAt!, timezone)} : {e.cancelReason}</div>
      ) : (
        <ol className="mb-4 grid grid-cols-4 gap-1.5" data-testid="event-status" aria-label={EVENT_STATUS[e.status].label}>
          {STEPS.map(([s, label], i) => (
            <li key={s} className={`rounded-xl px-2 py-2 text-center text-xs font-bold ${i < step ? "bg-green-500/15 text-green-700 dark:text-green-400" : i === step ? "bg-brand text-white shadow-glow" : "surface-2 text-muted"}`}>
              {i < step ? <Check className="mr-1 inline h-3.5 w-3.5" /> : null}{label}
            </li>
          ))}
        </ol>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4"><p className="text-xs uppercase text-muted">Total TTC</p><p className="text-2xl font-extrabold" data-testid="event-total"><Money amount={e.totalTtc} /></p><p className="text-xs text-muted">{e.guests} pers. · <Money amount={e.guests ? Math.round(e.totalTtc / e.guests) : 0} /> / pers.</p></div>
        <div className={`card p-4 ${e.depositDue && e.status === "ACCEPTED" ? "ring-2 ring-orange-400/50" : ""}`}><p className="text-xs uppercase text-muted">Acompte demandé</p><p className="text-2xl font-extrabold"><Money amount={e.depositAmount} /></p>{e.depositDue && e.status !== "CANCELLED" ? <p className="text-xs font-bold text-orange-600">attendu : <Money amount={e.depositDue} /></p> : e.depositAmount ? <p className="text-xs text-green-700">reçu</p> : null}</div>
        <div className="card p-4"><p className="text-xs uppercase text-muted">Reçu</p><p className="text-2xl font-extrabold" data-testid="event-paid"><Money amount={e.paid} /></p></div>
        <div className="card p-4"><p className="text-xs uppercase text-muted">Reste à payer</p><p className="text-2xl font-extrabold"><Money amount={e.status === "CANCELLED" ? 0 : e.remaining} /></p></div>
      </div>

      {/* Actions selon l'étape */}
      <div className="mb-6 flex flex-wrap gap-2">
        {e.status === "DRAFT" || e.status === "SENT" ? (
          <>
            {e.clientEmail ? <Button size="lg" onClick={() => send(true)} disabled={dirty || !e.totalTtc} data-testid="quote-email"><Mail className="h-5 w-5" />{e.status === "SENT" ? "Renvoyer" : "Envoyer"} le devis par e-mail</Button> : null}
            <Button size="lg" variant={e.clientEmail ? "secondary" : "primary"} onClick={() => send(false)} disabled={dirty || !e.totalTtc} data-testid="quote-handed"><Send className="h-5 w-5" />{e.status === "SENT" ? "Prolonger la validité" : "Devis remis au client"}</Button>
            {e.quoteNumber ? <Button size="lg" variant="secondary" onClick={accept} disabled={dirty} data-testid="quote-accept"><Check className="h-5 w-5" />Le client a accepté</Button> : null}
            {e.status === "SENT" ? <Button size="lg" variant="ghost" onClick={copyLink}><Copy className="h-5 w-5" />Lien d&apos;acceptation</Button> : null}
          </>
        ) : null}
        {e.status === "ACCEPTED" ? <Button size="lg" onClick={() => setInvoicing("0")} disabled={dirty} data-testid="event-invoice"><Receipt className="h-5 w-5" />Facturer <Money amount={e.totalTtc} /></Button> : null}
        {(e.status !== "CANCELLED" && e.remaining > 0 && e.totalTtc > 0) ? <Button size="lg" variant={e.status === "INVOICED" ? "primary" : "secondary"} onClick={() => setPay({ amount: String(e.status === "INVOICED" ? e.remaining : e.depositDue || ""), method: "TRANSFER", reference: "", refund: false })} data-testid="event-pay"><Banknote className="h-5 w-5" />{e.status === "INVOICED" ? "Enregistrer le règlement" : "Enregistrer un acompte"}</Button> : null}
        {e.status === "CANCELLED" && e.paid > 0 ? <Button size="lg" onClick={() => setPay({ amount: String(e.paid), method: "TRANSFER", reference: "", refund: true })}><Undo2 className="h-5 w-5" />Rembourser l&apos;acompte</Button> : null}
        <a href={`/api/catering/${id}/pdf?doc=quote`} target="_blank" rel="noopener" className="touch inline-flex h-14 items-center gap-2 rounded-2xl border border-line px-5 font-semibold hover:surface-2" data-testid="quote-pdf"><FileText className="h-5 w-5" />Devis PDF</a>
        {e.invoiceNumber ? <a href={`/api/catering/${id}/pdf?doc=invoice`} target="_blank" rel="noopener" className="touch inline-flex h-14 items-center gap-2 rounded-2xl border border-line px-5 font-semibold hover:surface-2" data-testid="invoice-pdf"><FileText className="h-5 w-5" />Facture {e.invoiceNumber}</a> : null}
        <a href={`/api/catering/${id}/kitchen`} target="_blank" rel="noopener" className="touch inline-flex h-14 items-center gap-2 rounded-2xl border border-line px-5 font-semibold hover:surface-2"><ChefHat className="h-5 w-5" />Fiche cuisine</a>
      </div>
      {dirty && !locked ? <p className="-mt-4 mb-4 text-sm font-semibold text-orange-600">Enregistrez le devis avant de l&apos;envoyer.</p> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        {/* Devis */}
        <section className="card p-4">
          <div className="mb-3 flex items-center gap-2">
            <h2 className="flex-1 text-base font-extrabold">Devis {e.quoteNumber ? <span className="text-muted">{e.quoteNumber}</span> : null}</h2>
            {e.quoteSentAt ? <span className="text-xs text-muted">{e.status === "SENT" && e.validUntil ? `valable jusqu'au ${formatDate(e.validUntil, timezone)}` : `remis le ${formatDate(e.quoteSentAt, timezone)}`}</span> : null}
          </div>
          {e.acceptedAt ? <p className="mb-3 rounded-xl bg-green-500/10 px-3 py-2 text-sm font-semibold text-green-700 dark:text-green-400">{e.acceptedBy ? `Accepté en ligne par ${e.acceptedBy} le ${formatDateTime(e.acceptedAt, timezone)}` : `Confirmé le ${formatDate(e.acceptedAt, timezone)}`}</p> : null}
          <div className="space-y-2" data-testid="quote-lines">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 rounded-xl surface-2 p-2 sm:grid-cols-[1fr_70px_100px_90px_auto] sm:items-center">
                <Input value={l.label} disabled={locked} onChange={(ev) => setLine(i, { label: ev.target.value })} aria-label={`Désignation ligne ${i + 1}`} className="col-span-2 sm:col-span-1" />
                <Input inputMode="decimal" value={l.quantity} disabled={locked} onChange={(ev) => setLine(i, { quantity: ev.target.value })} aria-label={`Quantité ligne ${i + 1}`} />
                <Input inputMode="numeric" value={l.unitPrice} disabled={locked} onChange={(ev) => setLine(i, { unitPrice: ev.target.value.replace(/[^\d]/g, "") })} aria-label={`Prix unitaire TTC ligne ${i + 1}`} />
                <Select value={l.taxRateBps} disabled={locked} onChange={(ev) => { const t = catalogQ.data?.taxRates.find((x) => x.rateBps === Number(ev.target.value)); setLine(i, { taxRateBps: Number(ev.target.value), taxRateName: t?.name ?? null }); }} aria-label={`TVA ligne ${i + 1}`}>
                  {(catalogQ.data?.taxRates.some((t) => t.rateBps === l.taxRateBps) ? catalogQ.data.taxRates : [...(catalogQ.data?.taxRates ?? []), { name: l.taxRateName ?? `${l.taxRateBps / 100} %`, rateBps: l.taxRateBps, isDefault: false }]).map((t) => <option key={t.rateBps} value={t.rateBps}>TVA {(t.rateBps / 100).toLocaleString("fr-FR")} %</option>)}
                </Select>
                {!locked ? <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="touch flex h-11 w-11 items-center justify-center rounded-xl text-red-600 hover:bg-red-500/10" aria-label={`Retirer la ligne ${i + 1}`}><Trash2 className="h-4 w-4" /></button> : <span />}
              </div>
            ))}
            {!lines.length ? <p className="py-4 text-center text-sm text-muted">Ajoutez les plats de votre carte ou une ligne libre (location de salle, service, livraison…).</p> : null}
          </div>
          {!locked ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Select value="" onChange={(ev) => { if (ev.target.value) addProduct(ev.target.value); }} aria-label="Ajouter un plat de la carte" className="min-w-0 flex-1">
                <option value="">+ Ajouter un plat de la carte…</option>
                {catalogQ.data?.products.map((p) => <option key={p.id} value={p.id}>{p.category ? `${p.category} · ` : ""}{p.name} — {p.priceTtc.toLocaleString("fr-FR")} F</option>)}
              </Select>
              <Button variant="secondary" onClick={() => setLines([...lines, { label: "", quantity: "1", unitPrice: "", taxRateBps: defaultRate?.rateBps ?? 0, taxRateName: defaultRate?.name ?? null }])} data-testid="line-add"><Plus className="h-4 w-4" />Ligne libre</Button>
            </div>
          ) : null}
          <div className="mt-4 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
            <div className="text-sm">
              {totals.taxes.map((t) => <p key={t.rateBps} className="text-muted">{t.name} : HT <Money amount={t.ht} /> · TVA <Money amount={t.tax} /></p>)}
              <p className="mt-1 text-lg font-extrabold">Total TTC <Money amount={totals.totalTtc} /></p>
            </div>
            <div>
              <Field label="Acompte à la commande (F CFP)">
                <div className="flex gap-1.5">
                  <Input inputMode="numeric" value={deposit} disabled={locked} onChange={(ev) => setDeposit(ev.target.value.replace(/[^\d]/g, ""))} aria-label="Acompte demandé" />
                  {!locked ? [30, 50].map((p) => <Button key={p} size="sm" variant="secondary" className="h-11" onClick={() => setDeposit(String(Math.round((totals.totalTtc * p) / 100 / 100) * 100))}>{p} %</Button>) : null}
                </div>
              </Field>
            </div>
          </div>
          {!locked ? <Button size="lg" className="mt-3 w-full" onClick={saveLines} disabled={!dirty || !linesValid || (totals.totalTtc > 0 && depositN > totals.totalTtc)} data-testid="quote-save">Enregistrer le devis</Button> : null}
        </section>

        {/* Événement, client, paiements */}
        <aside className="space-y-4">
          <section className="card p-4 text-sm">
            <h2 className="mb-2 text-base font-extrabold">Événement</h2>
            <p className="flex items-center gap-2"><Users className="h-4 w-4 text-muted" />{e.guests} personnes</p>
            <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted" />{e.location ?? "Au restaurant"}</p>
            {e.privatize ? <p className="flex items-center gap-2 font-semibold text-violet-700 dark:text-violet-300"><Lock className="h-4 w-4" />Privatisé : réservations en ligne fermées</p> : null}
            <h2 className="mb-1 mt-4 text-base font-extrabold">Client</h2>
            <p className="font-semibold">{e.clientCompany || e.clientName}</p>
            {e.clientCompany ? <p>{e.clientName}</p> : null}
            {[e.clientEmail, e.clientPhone, e.clientTahitiNumber ? `N° Tahiti ${e.clientTahitiNumber}` : null, e.clientAddress].filter(Boolean).map((x) => <p key={x} className="text-muted">{x}</p>)}
            {e.kitchenNotes ? <><h2 className="mb-1 mt-4 text-base font-extrabold">Cuisine</h2><p className="whitespace-pre-line">{e.kitchenNotes}</p></> : null}
            {e.internalNotes ? <><h2 className="mb-1 mt-4 text-base font-extrabold">Notes internes</h2><p className="whitespace-pre-line text-muted">{e.internalNotes}</p></> : null}
          </section>
          <section className="card p-4">
            <h2 className="mb-2 text-base font-extrabold">Paiements</h2>
            {e.payments.length ? (
              <ul className="space-y-2 text-sm" data-testid="event-payments">
                {e.payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1"><p className="font-semibold">{KIND_LABEL[p.kind]} · {CATERING_METHODS[p.method]}</p><p className="text-xs text-muted">{formatDate(p.receivedAt, timezone)}{p.reference ? ` · ${p.reference}` : ""}</p></div>
                    <span className={`font-bold ${p.kind === "REFUND" ? "text-red-600" : "text-green-700 dark:text-green-400"}`}>{p.kind === "REFUND" ? "−" : "+"} <Money amount={p.amount} /></span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Aucun paiement reçu.</p>}
          </section>
          {e.status !== "INVOICED" && e.status !== "CANCELLED" ? (
            <div className="flex flex-col gap-2">
              {!e.quoteNumber && !e.payments.length ? <Button variant="ghost" className="text-red-600" onClick={remove}><Trash2 className="h-4 w-4" />Supprimer le brouillon</Button>
                : <Button variant="ghost" className="text-red-600" onClick={() => setCancel("")} data-testid="event-cancel"><XCircle className="h-4 w-4" />Annuler l&apos;événement</Button>}
            </div>
          ) : null}
          {e.status === "INVOICED" ? <p className="text-xs text-muted"><Badge color="blue">Facturé</Badge> le {formatDate(e.invoicedAt!, timezone)}{e.invoiceDueAt && e.invoicedAt && new Date(e.invoiceDueAt).getTime() - new Date(e.invoicedAt).getTime() > 86_400_000 ? `, à régler avant le ${formatDate(e.invoiceDueAt, timezone)}` : ", à régler à réception"}.</p> : null}
        </aside>
      </div>

      {edit ? <EventForm event={e} onClose={() => setEdit(false)} /> : null}
      {pay ? (
        <Modal open onClose={() => setPay(null)} size="sm" title={pay.refund ? "Remboursement" : e.status === "INVOICED" ? "Règlement reçu" : "Acompte reçu"} footer={<Button size="lg" className="w-full" onClick={savePay} disabled={!Number.isInteger(payAmount) || payAmount <= 0} data-testid="payment-save">Enregistrer</Button>}>
          <div className="grid gap-3">
            <Field label="Montant (F CFP)"><Input inputMode="numeric" autoFocus value={pay.amount} onChange={(ev) => setPay({ ...pay, amount: ev.target.value.replace(/[^\d]/g, "") })} aria-label="Montant du paiement" /></Field>
            <Field label="Moyen"><Select value={pay.method} onChange={(ev) => setPay({ ...pay, method: ev.target.value as CateringMethod })} aria-label="Moyen de paiement">{Object.entries(CATERING_METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Référence (n° de chèque, virement…)"><Input value={pay.reference} onChange={(ev) => setPay({ ...pay, reference: ev.target.value })} aria-label="Référence du paiement" /></Field>
            {pay.method === "CASH" ? <p className="text-xs text-muted">En espèces, le montant {pay.refund ? "sort de" : "entre dans"} la caisse ouverte.</p> : null}
          </div>
        </Modal>
      ) : null}
      {invoicing !== null ? (
        <Modal open onClose={() => setInvoicing(null)} size="sm" title="Facture finale" footer={<Button size="lg" className="w-full" onClick={saveInvoice} data-testid="invoice-confirm">Émettre la facture</Button>}>
          <p className="mb-3 text-sm text-muted">La facture reprend les lignes du devis telles qu&apos;elles sont maintenant ({e.lines.length} ligne{e.lines.length > 1 ? "s" : ""}, <Money amount={e.totalTtc} />). Une fois émise, elle ne se modifie plus.{e.paid ? <> Les <Money amount={e.paid} /> déjà reçus sont déduits.</> : null}</p>
          <Field label="Règlement"><Select value={invoicing} onChange={(ev) => setInvoicing(ev.target.value)} aria-label="Délai de règlement">{[0, 15, 30].map((d) => <option key={d} value={d}>{d === 0 ? "À réception" : `Sous ${d} jours`}</option>)}</Select></Field>
        </Modal>
      ) : null}
      {cancel !== null ? (
        <Modal open onClose={() => setCancel(null)} size="sm" title="Annuler l'événement" footer={<Button size="lg" variant="danger" className="w-full" onClick={saveCancel} disabled={!cancel.trim()}>Annuler l&apos;événement</Button>}>
          <Field label="Motif"><Input autoFocus value={cancel} onChange={(ev) => setCancel(ev.target.value)} placeholder="ex. Date reportée par le client" aria-label="Motif de l'annulation" /></Field>
          {e.paid ? <p className="mt-2 text-xs text-muted">Acompte reçu : <Money amount={e.paid} />. Vous pourrez le rembourser ensuite, ou le conserver selon vos conditions.</p> : null}
        </Modal>
      ) : null}
    </div>
  );
}
