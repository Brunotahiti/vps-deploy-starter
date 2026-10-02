"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift, Mail, Printer, QrCode, Send, Star, XCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { PageHeader, useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Empty, Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { addDays, formatDate, formatDateTime, localDay } from "@/lib/dates";

type Card = { id: string; code: string; initialAmount: number; balance: number; buyerName: string | null; recipientName: string | null; message: string | null; expiresAt: string | null; expired: boolean; status: "ACTIVE" | "CANCELLED"; saleMethod: string; createdAt: string };
type Campaign = { id: string; name: string; segment: Segment; subject: string; status: "SENDING" | "SENT"; recipients: number; sent: number; failed: number; createdAt: string };
type Segment = "ALL" | "INACTIVE" | "BIRTHDAY_MONTH" | "NEW";
const SEGMENTS: Record<Segment, string> = { ALL: "Tous les clients inscrits", INACTIVE: "Clients pas revenus depuis 2 mois", BIRTHDAY_MONTH: "Anniversaires du mois", NEW: "Nouveaux clients (30 jours)" };
const SALE: Record<string, string> = { CASH: "Espèces", CARD: "Carte bancaire", CHECK: "Chèque", TRANSFER: "Virement", OFFERED: "Offerte" };
const AMOUNTS = [3000, 5000, 10000, 20000];

function GiftCards() {
  const act = useAction();
  const { can, timezone } = useSession();
  const q = useQuery({ queryKey: ["gift-cards"], queryFn: () => api.get<{ cards: Card[]; outstanding: number; sold: number }>("/api/gift-cards") });
  const [sell, setSell] = useState<{ amount: string; method: string; reference: string; buyerName: string; recipientName: string; message: string; expiresOn: string } | null>(null);
  const [cancel, setCancel] = useState<Card | null>(null);
  const [reason, setReason] = useState("");
  const amount = sell ? Number(sell.amount.replace(/\s/g, "")) : 0;
  const save = async () => {
    if (!sell || !Number.isInteger(amount) || amount < 100) return;
    const r = await act(() => api.post<{ id: string; code: string }>("/api/gift-cards", { amount, method: sell.method, reference: sell.reference || null, buyerName: sell.buyerName || null, recipientName: sell.recipientName || null, message: sell.message || null, expiresOn: sell.expiresOn || null }), { success: "Carte cadeau vendue", invalidate: [["gift-cards"], ["cash"]] });
    if (!r) return;
    setSell(null);
    window.open(`/api/gift-cards/${r.id}/print`, "_blank", "noopener");
  };
  const doCancel = async () => {
    if (!cancel || !reason.trim()) return;
    const r = await act(() => api.post(`/api/gift-cards/${cancel.id}/cancel`, { reason }), { success: `Carte ${cancel.code} annulée`, invalidate: [["gift-cards"]] });
    if (r) { setCancel(null); setReason(""); }
  };
  const today = localDay(new Date(), timezone);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={() => setSell({ amount: "5000", method: "CARD", reference: "", buyerName: "", recipientName: "", message: "", expiresOn: addDays(today, 365) })} data-testid="giftcard-sell"><Gift className="h-5 w-5" />Vendre une carte cadeau</Button>
        {q.data ? <p className="text-sm text-muted">Solde restant à utiliser : <b className="text-[var(--text)]"><Money amount={q.data.outstanding} /></b></p> : null}
      </div>
      {q.isLoading ? <Spinner /> : !q.data?.cards.length ? <Empty title="Aucune carte cadeau" hint="Vendez une carte : elle s'imprime avec son code, et s'utilise ensuite à la caisse comme moyen de paiement." /> : (
        <ul className="card divide-y divide-[var(--border)]">
          {q.data.cards.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="giftcard-row">
              <span className="font-mono text-base font-bold tracking-wider">{c.code}</span>
              <div className="min-w-0 flex-1 basis-40">
                <p className="text-sm">{c.recipientName ? `Pour ${c.recipientName}` : "Carte cadeau"}{c.buyerName ? ` · de ${c.buyerName}` : ""}</p>
                <p className="text-xs text-muted">Vendue le {formatDate(c.createdAt, timezone)} · {SALE[c.saleMethod] ?? c.saleMethod}{c.expiresAt ? ` · valable jusqu'au ${formatDate(c.expiresAt, timezone)}` : ""}</p>
              </div>
              <div className="text-right"><p className="font-extrabold"><Money amount={c.balance} /></p><p className="text-xs text-muted">sur <Money amount={c.initialAmount} /></p></div>
              {c.status === "CANCELLED" ? <Badge color="gray">Annulée</Badge> : c.expired ? <Badge color="orange">Expirée</Badge> : c.balance === 0 ? <Badge color="green">Utilisée</Badge> : <Badge color="teal">Active</Badge>}
              <div className="flex gap-1">
                <a href={`/api/gift-cards/${c.id}/print`} target="_blank" rel="noopener" className="touch flex h-9 w-9 items-center justify-center rounded-xl border border-line hover:surface-2" aria-label={`Imprimer ${c.code}`}><Printer className="h-4 w-4" /></a>
                {can("marketing.manage") && c.status === "ACTIVE" ? <button onClick={() => setCancel(c)} className="touch flex h-9 w-9 items-center justify-center rounded-xl border border-line text-red-600 hover:surface-2" aria-label={`Annuler ${c.code}`}><XCircle className="h-4 w-4" /></button> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {sell ? (
        <Modal open onClose={() => setSell(null)} size="sm" title="Vendre une carte cadeau" footer={<Button size="lg" className="w-full" onClick={save} disabled={!Number.isInteger(amount) || amount < 100} data-testid="giftcard-save">{sell.method === "OFFERED" ? "Créer et imprimer" : <>Encaisser <Money amount={amount || 0} /> et imprimer</>}</Button>}>
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">{AMOUNTS.map((a) => <button key={a} type="button" onClick={() => setSell({ ...sell, amount: String(a) })} className={`touch rounded-xl border px-3 py-2 text-sm font-bold ${amount === a ? "border-lagon-500 bg-lagon-500/10" : "border-line"}`}><Money amount={a} /></button>)}</div>
            <Field label="Montant (F CFP)"><Input inputMode="numeric" value={sell.amount} onChange={(e) => setSell({ ...sell, amount: e.target.value })} aria-label="Montant de la carte" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Encaissement"><Select value={sell.method} onChange={(e) => setSell({ ...sell, method: e.target.value })} aria-label="Encaissement">{Object.entries(SALE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
              <Field label="Valable jusqu'au"><Input type="date" min={addDays(today, 1)} value={sell.expiresOn} onChange={(e) => setSell({ ...sell, expiresOn: e.target.value })} aria-label="Date de validité" /></Field>
            </div>
            {sell.method === "OFFERED" ? <p className="rounded-lg bg-orange-500/10 px-3 py-2 text-xs text-orange-700 dark:text-orange-300">Carte offerte (geste commercial, jeu, partenariat) : rien n&apos;est encaissé.</p> : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="De la part de"><Input value={sell.buyerName} onChange={(e) => setSell({ ...sell, buyerName: e.target.value })} aria-label="Acheteur" /></Field>
              <Field label="Pour"><Input value={sell.recipientName} onChange={(e) => setSell({ ...sell, recipientName: e.target.value })} aria-label="Bénéficiaire" /></Field>
            </div>
            <Field label="Petit mot (imprimé sur la carte)"><Textarea rows={2} value={sell.message} onChange={(e) => setSell({ ...sell, message: e.target.value })} aria-label="Message" /></Field>
          </div>
        </Modal>
      ) : null}
      {cancel ? (
        <Modal open onClose={() => setCancel(null)} size="sm" title={`Annuler la carte ${cancel.code}`} footer={<Button size="lg" variant="danger" className="w-full" onClick={doCancel} disabled={!reason.trim()}>Annuler la carte</Button>}>
          <p className="mb-3 text-sm text-muted">Le solde restant (<Money amount={cancel.balance} />) ne sera plus utilisable.</p>
          <Field label="Motif"><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Carte perdue, vente annulée…" aria-label="Motif" /></Field>
        </Modal>
      ) : null}
    </div>
  );
}

function Campaigns() {
  const act = useAction();
  const { timezone } = useSession();
  const list = useQuery({ queryKey: ["campaigns"], queryFn: () => api.get<Campaign[]>("/api/marketing/campaigns"), refetchInterval: (q) => (q.state.data?.some((c) => c.status === "SENDING") ? 3000 : false) });
  const [f, setF] = useState({ name: "", segment: "ALL" as Segment, subject: "", body: "" });
  const preview = useQuery({ queryKey: ["campaign-preview", f.segment], queryFn: () => api.get<{ count: number; sample: string[] }>(`/api/marketing/segments?segment=${f.segment}`) });
  const ready = f.name.trim() && f.subject.trim() && f.body.trim() && (preview.data?.count ?? 0) > 0;
  const send = async () => {
    if (!ready || !confirm(`Envoyer « ${f.subject} » à ${preview.data!.count} client(s) ?`)) return;
    const r = await act(() => api.post("/api/marketing/campaigns", f), { success: "Campagne en cours d'envoi", invalidate: [["campaigns"]] });
    if (r) setF({ name: "", segment: "ALL", subject: "", body: "" });
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <section className="card p-5">
        <h2 className="mb-3 text-base font-extrabold">Nouvelle campagne</h2>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom (pour vous)"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="ex. Soirée spéciale de juillet" aria-label="Nom de la campagne" /></Field>
            <Field label="Destinataires"><Select value={f.segment} onChange={(e) => setF({ ...f, segment: e.target.value as Segment })} aria-label="Destinataires">{(Object.keys(SEGMENTS) as Segment[]).map((k) => <option key={k} value={k}>{SEGMENTS[k]}</option>)}</Select></Field>
          </div>
          <p className="text-sm" data-testid="campaign-count">{preview.isLoading ? "…" : <><b>{preview.data?.count ?? 0}</b> client{(preview.data?.count ?? 0) > 1 ? "s" : ""} inscrit{(preview.data?.count ?? 0) > 1 ? "s" : ""}{preview.data?.sample.length ? <span className="text-muted"> · {preview.data.sample.join(", ")}{(preview.data.count ?? 0) > preview.data.sample.length ? "…" : ""}</span> : null}</>}</p>
          <Field label="Objet de l'e-mail"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} aria-label="Objet" /></Field>
          <Field label="Message"><Textarea rows={7} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder={"Votre offre, votre nouveauté, votre soirée…\n\nUne ligne vide sépare les paragraphes."} aria-label="Message" /></Field>
          <p className="text-xs text-muted">Envoyée seulement aux clients qui ont accepté de recevoir vos offres (case dans leur fiche), avec un lien pour se désabonner.</p>
          <div><Button size="lg" onClick={send} disabled={!ready} data-testid="campaign-send"><Send className="h-5 w-5" />Envoyer</Button></div>
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-base font-extrabold">Envoyées</h2>
        {list.data?.length ? (
          <ul className="card divide-y divide-[var(--border)]">
            {list.data.map((c) => (
              <li key={c.id} className="px-4 py-3">
                <p className="font-bold">{c.name}</p>
                <p className="text-xs text-muted">{formatDateTime(c.createdAt, timezone)} · {SEGMENTS[c.segment]}</p>
                <p className="mt-1 text-xs">{c.status === "SENDING" ? <Badge color="orange">Envoi : {c.sent}/{c.recipients}</Badge> : <Badge color="green">{c.sent} envoyé{c.sent > 1 ? "s" : ""}{c.failed ? `, ${c.failed} échec${c.failed > 1 ? "s" : ""}` : ""}</Badge>}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Aucune campagne envoyée.</p>}
      </section>
    </div>
  );
}

function Reviews() {
  const act = useAction();
  const q = useQuery({ queryKey: ["review-settings"], queryFn: () => api.get<{ reviewUrl: string }>("/api/marketing/review") });
  const [url, setUrl] = useState<string | null>(null);
  const value = url ?? q.data?.reviewUrl ?? "";
  const valid = !value || /^https:\/\/\S+$/.test(value.trim());
  const save = () => act(() => api.put("/api/marketing/review", { reviewUrl: value.trim() || null }), { success: "Lien d'avis enregistré", invalidate: [["review-settings"]] });
  if (q.isLoading) return <Spinner />;
  return (
    <section className="card max-w-2xl p-5">
      <h2 className="flex items-center gap-2 text-base font-extrabold"><Star className="h-5 w-5 text-amber-500" />Avis Google</h2>
      <p className="mt-1 text-sm text-muted">Collez le lien « Demander des avis » de votre fiche d&apos;établissement Google. Il apparaît sur les reçus envoyés par e-mail et sur une affichette avec QR code pour vos tables.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input className="min-w-0 flex-1" value={value} onChange={(e) => setUrl(e.target.value)} placeholder="https://g.page/r/…/review" aria-label="Lien d'avis" />
        <Button onClick={save} disabled={!valid}>Enregistrer</Button>
      </div>
      {!valid ? <p className="mt-2 text-sm text-red-600">Lien attendu commençant par https://</p> : null}
      {q.data?.reviewUrl ? <a href="/api/marketing/review-poster" target="_blank" rel="noopener" className="mt-4 inline-flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:surface-2"><QrCode className="h-4 w-4" />Imprimer l&apos;affichette « Votre avis compte »</a> : null}
    </section>
  );
}

/** Marketing & cartes cadeaux (option). */
export default function MarketingPage() {
  const { can, hasOption } = useSession();
  const manage = can("marketing.manage");
  const allowed = hasOption("marketing") && (manage || can("giftcards.sell"));
  const [tab, setTab] = useState<"cards" | "campaigns" | "reviews">("cards");
  if (!allowed) return <Empty title="Marketing & cartes cadeaux" hint="Cette option se débloque dans Gestion → Options." />;
  const tabs = [{ key: "cards" as const, label: "Cartes cadeaux", icon: Gift }, ...(manage ? [{ key: "campaigns" as const, label: "Campagnes", icon: Mail }, { key: "reviews" as const, label: "Avis Google", icon: Star }] : [])];
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Marketing" subtitle="Cartes cadeaux, campagnes par e-mail et avis clients : faites revenir vos clients." />
      <div role="tablist" className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)} className={`touch flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${tab === t.key ? "bg-brand text-white shadow-glow" : "surface-2 text-muted hover:text-[var(--text)]"}`}><t.icon className="h-4 w-4" />{t.label}</button>)}
      </div>
      {tab === "cards" ? <GiftCards /> : null}
      {tab === "campaigns" && manage ? <Campaigns /> : null}
      {tab === "reviews" && manage ? <Reviews /> : null}
    </div>
  );
}
