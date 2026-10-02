"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { NumPad } from "@/components/ui/numpad";
import { Money } from "@/components/money";
import { formatMoney } from "@/lib/money";
import { splitByItems, splitBySeat, splitEqually } from "@/lib/split";
import { useSession } from "@/hooks/use-session";
import { Banknote, BookUser, CreditCard, FileText, Landmark, Ticket, Gift, MoreHorizontal, Users, SplitSquareHorizontal, ListChecks, Calculator } from "lucide-react";
import { PAYMENT_LABEL, type Order, type PosCatalog } from "./types";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = { CASH: Banknote, CARD: CreditCard, CHECK: FileText, TRANSFER: Landmark, MEAL_VOUCHER: Ticket, COMPLIMENTARY: Gift, OTHER: MoreHorizontal, ACCOUNT: BookUser, GIFT_CARD: Gift };

type PosAccount = { id: string; name: string; contactName: string | null; balance: number; creditLimit: number | null; available: number | null };
export type PaymentPayload = { method: string; amount: number; tendered?: number; reference?: string | null; splitLabel?: string | null; customerAccountId?: string | null; giftCardCode?: string | null };

export function PaymentModal({ order, methods, open, onClose, onPay, onPaid }: { order: Order; methods: PosCatalog["paymentMethods"]; open: boolean; onClose: () => void; onPay: (payments: PaymentPayload[]) => Promise<void>; onPaid: (order: Order) => void }) {
  const { currency, hasOption, can } = useSession();
  // « Sur compte » (option Comptes clients) : addition mise sur le compte d'un client pro, facturée ensuite
  const accountsOn = hasOption("accounts") && (can("accounts.charge") || can("accounts.manage"));
  const accounts = useQuery({ queryKey: ["accounts", "pos"], queryFn: () => api.get<PosAccount[]>("/api/accounts/pos"), enabled: open && accountsOn, staleTime: 30_000 });
  const [accountId, setAccountId] = useState<string | null>(null);
  // Carte cadeau (option Marketing) : code vérifié en ligne, montant plafonné au solde
  const giftOn = hasOption("marketing");
  const [giftCode, setGiftCode] = useState("");
  const [gift, setGift] = useState<{ code: string; balance: number; expired: boolean; status: string } | null>(null);
  const [giftErr, setGiftErr] = useState<string | null>(null);
  const checkGift = async () => {
    setGiftErr(null); setGift(null);
    try {
      const g = await api.get<{ code: string; balance: number; expired: boolean; status: string }>(`/api/gift-cards/lookup?code=${encodeURIComponent(giftCode)}`);
      if (g.status !== "ACTIVE") setGiftErr(`Carte ${g.code} annulée`);
      else if (g.expired) setGiftErr(`Carte ${g.code} expirée`);
      else if (g.balance <= 0) setGiftErr(`Carte ${g.code} déjà entièrement utilisée`);
      else { setGift(g); setAmountStr(String(Math.min(g.balance, remaining))); setLabel(`Carte ${g.code}`); }
    } catch (e) { setGiftErr(e instanceof ApiClientError ? e.message : "Vérification impossible (connexion ?)"); }
  };
  const [accountSearch, setAccountSearch] = useState("");
  const remaining = order.total - order.paidTotal;
  const [method, setMethod] = useState(methods[0]?.method ?? "CASH");
  const [mode, setMode] = useState<"pay" | "split">("pay");
  const [amountStr, setAmountStr] = useState(String(remaining));
  const [tenderedStr, setTenderedStr] = useState("");
  const [label, setLabel] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [loading, setLoading] = useState(false);
  const [splitKind, setSplitKind] = useState<"equal" | "seat" | "items" | "custom">("equal");
  const [parts, setParts] = useState(Math.max(2, order.covers));
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const { toast } = useToast();
  const terminal = useQuery({ queryKey: ["terminal-settings"], queryFn: () => api.get<{ connected: boolean }>("/api/payments/terminal/settings"), staleTime: 300_000 });
  const [tpeBusy, setTpeBusy] = useState(false);
  /** TPE connecté : le serveur débite la carte ET enregistre le paiement en une seule requête (jamais mise en file hors ligne). */
  const payWithTerminal = async () => {
    if (tpeBusy) return;
    setTpeBusy(true);
    try {
      const r = await api.post<{ providerRef: string | null; amount: number; order: Order }>("/api/payments/terminal/charge", { orderId: order.id, amount, paymentId: crypto.randomUUID(), splitLabel: label }, { idempotencyKey: crypto.randomUUID() });
      setReference("");
      onPaid(r.order);
    } catch (e) { toast(e instanceof ApiClientError ? e.message : "Transaction TPE impossible", "error"); }
    finally { setTpeBusy(false); }
  };


  const amount = Math.min(Number(amountStr || 0), remaining);
  const tendered = Number(tenderedStr || 0);
  const change = method === "CASH" && tendered > 0 ? Math.max(0, tendered - amount) : 0;
  const activeItems = useMemo(() => order.items.filter((i) => i.status !== "VOIDED" && !i.parentItemId), [order.items]);
  const seatSplit = useMemo(() => splitBySeat(activeItems.map((i) => ({ id: i.id, lineTotal: i.lineTotal + order.items.filter((c) => c.parentItemId === i.id).reduce((a, c) => a + c.lineTotal, 0), seatNumber: i.seatNumber })), order.covers), [activeItems, order.items, order.covers]);
  const equalParts = useMemo(() => splitEqually(order.total, parts), [order.total, parts]);

  const applySplitAmount = (value: number, l: string) => { setAmountStr(String(Math.min(value, remaining))); setLabel(l); setMode("pay"); };

  const pay = async () => {
    if (amount <= 0) return;
    setLoading(true);
    try {
      await onPay([{ method, amount, tendered: method === "CASH" && tendered > 0 ? tendered : undefined, reference: reference || null, splitLabel: label, ...(method === "ACCOUNT" ? { customerAccountId: accountId } : {}), ...(method === "GIFT_CARD" ? { giftCardCode: gift?.code ?? null } : {}) }]);
      if (method === "GIFT_CARD") { setGift(null); setGiftCode(""); }
      setReference("");
    } finally {
      setLoading(false);
    }
  };

  const quickCash = [500, 1000, 2000, 5000, 10000].filter((v) => v >= amount).slice(0, 3);
  const roundUp = Math.ceil((amount) / 1000) * 1000;

  return (
    <Modal open={open} onClose={onClose} title={`Encaisser · ${order.number}`} size="xl">
      <div className="mb-4 grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl surface-2 p-3"><p className="text-xs uppercase text-muted">Total</p><p className="text-xl font-bold"><Money amount={order.total} /></p></div>
        <div className="rounded-xl surface-2 p-3"><p className="text-xs uppercase text-muted">Déjà payé</p><p className="text-xl font-bold"><Money amount={order.paidTotal} /></p></div>
        <div className="rounded-xl bg-lagon-600 p-3 text-white"><p className="text-xs uppercase opacity-80">Reste à payer</p><p className="text-xl font-bold"><Money amount={remaining} /></p></div>
      </div>
      <div className="mb-4 flex gap-2">
        <button onClick={() => setMode("pay")} className={`touch h-11 flex-1 rounded-xl text-sm font-bold ${mode === "pay" ? "bg-lagon-600 text-white" : "surface-2"}`}>Paiement</button>
        <button onClick={() => setMode("split")} className={`touch h-11 flex-1 rounded-xl text-sm font-bold ${mode === "split" ? "bg-lagon-600 text-white" : "surface-2"}`}><SplitSquareHorizontal className="mr-1 inline h-4 w-4" />Diviser l&apos;addition</button>
      </div>

      {mode === "split" ? (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {([["equal", "Parts égales", Users], ["seat", "Par client", Users], ["items", "Par article", ListChecks], ["custom", "Montant", Calculator]] as const).map(([k, l, I]) => (
              <button key={k} onClick={() => setSplitKind(k)} className={`touch flex h-14 flex-col items-center justify-center rounded-xl text-xs font-bold ${splitKind === k ? "bg-lagon-600 text-white" : "surface-2"}`}><I className="h-5 w-5" />{l}</button>
            ))}
          </div>
          {splitKind === "equal" ? (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <span className="text-sm font-semibold">Nombre de parts</span>
                <Button variant="secondary" onClick={() => setParts((p) => Math.max(2, p - 1))}>−</Button><span className="w-8 text-center text-xl font-bold">{parts}</span><Button variant="secondary" onClick={() => setParts((p) => Math.min(50, p + 1))}>+</Button>
                <span className="ml-auto text-sm text-muted">{formatMoney(order.total, currency)} / {parts} = <strong><Money amount={equalParts[0]} /></strong></span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {equalParts.map((p, i) => <button key={i} onClick={() => applySplitAmount(p, `Part ${i + 1}/${parts}`)} className="touch h-14 rounded-xl surface-2 text-sm font-bold">Part {i + 1}<br /><Money amount={p} /></button>)}
              </div>
            </div>
          ) : null}
          {splitKind === "seat" ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {seatSplit.map((s) => (
                <button key={s.seat} onClick={() => applySplitAmount(s.amount, `Client ${s.seat}`)} className="touch flex h-16 flex-col items-center justify-center rounded-xl surface-2 text-sm font-bold">Client {s.seat}<span className="text-xs text-muted">{s.itemIds.length} article{s.itemIds.length > 1 ? "s" : ""} + part commune</span><Money amount={s.amount} /></button>
              ))}
            </div>
          ) : null}
          {splitKind === "items" ? (
            <div>
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {activeItems.map((i) => {
                  const on = selectedItems.includes(i.id);
                  const total = i.lineTotal + order.items.filter((c) => c.parentItemId === i.id).reduce((a, c) => a + c.lineTotal, 0);
                  return (
                    <button key={i.id} onClick={() => setSelectedItems((s) => (on ? s.filter((x) => x !== i.id) : [...s, i.id]))} className={`touch flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm ${on ? "border-lagon-500 bg-lagon-500/10" : "border-line"}`}>
                      <span>{i.quantity} × {i.name}{i.seatNumber ? <span className="ml-2 text-xs text-muted">C{i.seatNumber}</span> : null}</span><Money amount={total} />
                    </button>
                  );
                })}
              </div>
              <Button className="mt-3 w-full" size="lg" disabled={selectedItems.length === 0} onClick={() => applySplitAmount(splitByItems(activeItems.map((i) => ({ id: i.id, lineTotal: i.lineTotal + order.items.filter((c) => c.parentItemId === i.id).reduce((a, c) => a + c.lineTotal, 0), seatNumber: i.seatNumber })), selectedItems), `${selectedItems.length} article(s)`)}>
                Payer la sélection · <Money amount={splitByItems(activeItems.map((i) => ({ id: i.id, lineTotal: i.lineTotal, seatNumber: i.seatNumber })), selectedItems)} />
              </Button>
            </div>
          ) : null}
          {splitKind === "custom" ? (
            <div className="mx-auto max-w-xs">
              <p className="mb-2 text-center text-2xl font-bold"><Money amount={Number(amountStr || 0)} /></p>
              <NumPad value={amountStr} onChange={setAmountStr} onSubmit={() => applySplitAmount(Number(amountStr || 0), "Montant personnalisé")} submitLabel="Utiliser" />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-[1fr_280px]">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {methods.map((m) => {
                const I = ICONS[m.method] ?? MoreHorizontal;
                return (
                  <button key={m.id} onClick={() => setMethod(m.method)} className={`touch flex h-16 flex-col items-center justify-center rounded-xl text-sm font-bold ${method === m.method ? "bg-lagon-600 text-white" : "surface-2"}`}><I className="h-5 w-5" />{m.label || PAYMENT_LABEL[m.method]}</button>
                );
              })}
              {giftOn ? <button onClick={() => setMethod("GIFT_CARD")} data-testid="pay-gift" className={`touch flex h-16 flex-col items-center justify-center rounded-xl text-sm font-bold ${method === "GIFT_CARD" ? "bg-lagon-600 text-white" : "surface-2"}`}><Gift className="h-5 w-5" />Carte cadeau</button> : null}
              {accountsOn && accounts.data?.length ? <button onClick={() => setMethod("ACCOUNT")} data-testid="pay-account" className={`touch flex h-16 flex-col items-center justify-center rounded-xl text-sm font-bold ${method === "ACCOUNT" ? "bg-lagon-600 text-white" : "surface-2"}`}><BookUser className="h-5 w-5" />Sur compte</button> : null}
            </div>
            {method === "GIFT_CARD" ? (
              <div className="rounded-xl border border-line p-3" data-testid="gift-picker">
                <div className="flex gap-2">
                  <input value={giftCode} onChange={(e) => { setGiftCode(e.target.value.toUpperCase()); setGift(null); }} onKeyDown={(e) => e.key === "Enter" && giftCode.trim() && checkGift()} placeholder="Code de la carte (ex. ABCD-EFGH)" aria-label="Code de la carte cadeau" autoCapitalize="characters" className="h-11 min-w-0 flex-1 rounded-lg border border-line surface px-3 font-mono text-sm tracking-wider" />
                  <Button variant="secondary" onClick={checkGift} disabled={!giftCode.trim()}>Vérifier</Button>
                </div>
                {gift ? <p className="mt-2 text-sm font-semibold text-green-700 dark:text-green-400" data-testid="gift-balance">Carte {gift.code} · solde <Money amount={gift.balance} /></p> : null}
                {giftErr ? <p className="mt-2 text-sm font-semibold text-red-600">{giftErr}</p> : null}
              </div>
            ) : null}
            {method === "ACCOUNT" ? (
              <div className="rounded-xl border border-line p-3" data-testid="account-picker">
                <input value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)} placeholder="Rechercher un client pro…" aria-label="Rechercher un compte" className="mb-2 h-10 w-full rounded-lg border border-line surface px-3 text-sm" />
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {(accounts.data ?? []).filter((a) => !accountSearch.trim() || `${a.name} ${a.contactName ?? ""}`.toLowerCase().includes(accountSearch.trim().toLowerCase())).map((a) => {
                    const short = a.available !== null && a.available < amount;
                    return (
                      <button key={a.id} onClick={() => setAccountId(a.id)} aria-pressed={accountId === a.id} className={`touch flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${accountId === a.id ? "border-lagon-500 bg-lagon-500/10" : "border-line"}`}>
                        <span className="min-w-0"><b className="block truncate">{a.name}</b><span className="text-xs text-muted">Encours <Money amount={a.balance} />{a.creditLimit !== null ? <> · plafond <Money amount={a.creditLimit} /></> : null}</span></span>
                        {a.available !== null ? <span className={`shrink-0 text-xs font-bold ${short ? "text-red-600" : "text-green-700 dark:text-green-400"}`}>{short ? "Plafond dépassé" : <>Dispo <Money amount={a.available} /></>}</span> : <span className="shrink-0 text-xs text-muted">Sans plafond</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="rounded-xl surface-2 p-3">
              <div className="flex items-baseline justify-between"><span className="text-xs uppercase text-muted">Montant {label ? `· ${label}` : ""}</span><span className="text-2xl font-bold"><Money amount={amount} /></span></div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => { setAmountStr(String(remaining)); setLabel(null); }} className="touch h-9 rounded-lg border border-line px-3 text-xs font-semibold">Solde total</button>
                {order.covers > 1 ? <button onClick={() => applySplitAmount(splitEqually(order.total, order.covers)[0], `1/${order.covers}`)} className="touch h-9 rounded-lg border border-line px-3 text-xs font-semibold">1/{order.covers}</button> : null}
              </div>
            </div>
            {method === "CASH" ? (
              <div className="rounded-xl surface-2 p-3">
                <div className="flex items-baseline justify-between"><span className="text-xs uppercase text-muted">Espèces reçues</span><span className="text-xl font-bold"><Money amount={tendered} /></span></div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button onClick={() => setTenderedStr(String(amount))} className="touch h-10 rounded-lg border border-line px-3 text-sm font-semibold">Compte juste</button>
                  {roundUp > amount ? <button onClick={() => setTenderedStr(String(roundUp))} className="touch h-10 rounded-lg border border-line px-3 text-sm font-semibold">{formatMoney(roundUp, currency)}</button> : null}
                  {quickCash.map((v) => <button key={v} onClick={() => setTenderedStr(String(v))} className="touch h-10 rounded-lg border border-line px-3 text-sm font-semibold">{formatMoney(v, currency)}</button>)}
                </div>
                {change > 0 ? <p className="mt-2 text-right text-lg font-bold text-corail-500">Rendu : <Money amount={change} /></p> : null}
              </div>
            ) : null}
            {["CARD", "CHECK", "TRANSFER", "OTHER"].includes(method) ? <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Référence (n° chèque, TPE…)" className="h-11 w-full rounded-xl border border-line surface px-3 text-sm" /> : null}
            {method === "CARD" && terminal.data?.connected ? <Button variant="accent" size="lg" className="w-full" loading={tpeBusy} disabled={amount <= 0} onClick={payWithTerminal}>Envoyer <Money amount={amount} /> au TPE</Button> : null}
            {method === "COMPLIMENTARY" ? <p className="rounded-lg bg-orange-500/10 px-3 py-2 text-xs text-orange-700 dark:text-orange-300">« Offert » vaut remise totale : autorisation manager requise.</p> : null}
            {order.payments.length > 0 ? (
              <div className="rounded-xl border border-line p-3 text-sm">
                <p className="mb-1 text-xs uppercase text-muted">Paiements enregistrés</p>
                {order.payments.map((p) => <div key={p.id} className="flex justify-between"><span>{PAYMENT_LABEL[p.method]}{p.splitLabel ? ` · ${p.splitLabel}` : ""}{p.tipAmount ? ` (+${formatMoney(p.tipAmount, currency)} pourboire)` : ""}</span><Money amount={p.amount - p.refundedAmount} /></div>)}
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <NumPad value={method === "CASH" && tenderedStr !== "" ? tenderedStr : amountStr} onChange={(v) => (method === "CASH" && tenderedStr !== "" ? setTenderedStr(v) : setAmountStr(v))} />
            {method === "CASH" ? <button onClick={() => setTenderedStr(tenderedStr === "" ? String(amount) : "")} className="touch h-10 w-full rounded-lg border border-line text-xs font-semibold">{tenderedStr === "" ? "Saisir les espèces reçues" : "Revenir au montant"}</button> : null}
            <Button size="xl" className="w-full" loading={loading} disabled={amount <= 0 || (method === "CASH" && tendered > 0 && tendered < amount) || (method === "ACCOUNT" && !accountId) || (method === "GIFT_CARD" && (!gift || amount > gift.balance))} onClick={pay}>
              {method === "ACCOUNT" ? "Mettre sur compte" : "Encaisser"} <Money amount={amount} />
            </Button>
            {amount < remaining ? <p className="text-center text-xs text-muted">Il restera <Money amount={remaining - amount} /> à payer</p> : <p className="text-center text-xs text-lagon-600">La commande sera clôturée</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
