"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { NumPad } from "@/components/ui/numpad";
import { Spinner, Card } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { Money } from "@/components/money";
import { formatDateTime } from "@/lib/dates";
import { useSession } from "@/hooks/use-session";
import { PinModal, withPin, type PinRequest } from "./pin-modal";
import { PAYMENT_LABEL } from "./types";
import { Archive } from "lucide-react";
import { reportPrint, type PrintResult } from "@/lib/print-client";
import { useOffline } from "@/lib/offline/provider";
import { addCashMovementLocal, closeCashLocal, openCashLocal, useCashCurrent } from "@/lib/offline/cash-local";
import { openDrawerLocal, type LocalPrinter } from "@/lib/offline/print-local";
import { usePosCatalog } from "./use-catalog";

const KIND_LABEL: Record<string, string> = { OPENING: "Ouverture", SALE: "Vente", REFUND: "Remboursement", PAY_IN: "Entrée", PAY_OUT: "Sortie", DEPOSIT: "Dépôt", CORRECTION: "Correction", CLOSING: "Clôture" };

export function CashScreen() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can, timezone, me } = useSession();
  const { online } = useOffline();
  const current = useCashCurrent();
  const userName = me?.user?.displayName || me?.user?.firstName || "";
  const [dialog, setDialog] = useState<"open" | "movement" | "close" | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<"PAY_IN" | "PAY_OUT" | "DEPOSIT" | "CORRECTION">("PAY_OUT");
  const [pin, setPin] = useState<PinRequest>(null);
  const [loading, setLoading] = useState(false);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["cash"] }); };
  const err = (e: unknown) => { if (!(e instanceof ApiClientError && e.isPinRequired)) toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); };
  const isQueued = (e: unknown) => e instanceof ApiClientError && e.code === "QUEUED";
  /**
   * Exécute une opération de caisse ; sans internet, elle part en file d'attente et `local` l'applique
   * à la copie de la caisse tenue sur la tablette (espèces théoriques à jour pendant la coupure).
   */
  const wrap = (fn: () => Promise<unknown>, local?: () => Promise<unknown>) => async () => {
    setLoading(true);
    const done = () => { setDialog(null); setAmount(""); setReason(""); refresh(); };
    try { await fn(); done(); }
    catch (e) {
      if (isQueued(e) && local) { await local(); done(); }
      else err(e);
    } finally { setLoading(false); }
  };

  if (current.isLoading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const s = current.data;

  return (
    <div className="mx-auto max-w-4xl space-y-4 overflow-y-auto p-4">
      {!s ? (
        <Card>
          <div className="py-8 text-center">
            <p className="text-xl font-bold">Aucune session de caisse ouverte</p>
            <p className="mt-1 text-sm text-muted">Ouvrez la caisse avec le fond de caisse pour commencer à encaisser des espèces.</p>
            {can("cash.open") ? <Button size="xl" className="mt-4" onClick={() => setDialog("open")}>Ouvrir la caisse</Button> : <p className="mt-4 text-sm text-corail-500">Vous n&apos;avez pas la permission d&apos;ouvrir la caisse.</p>}
            <div className="mt-3 flex justify-center"><DrawerButton /></div>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Card><p className="text-xs uppercase text-muted">Fond de caisse</p><p className="text-2xl font-bold"><Money amount={s.summary.openingFloat} /></p><p className="text-xs text-muted">ouverte {formatDateTime(s.session.openedAt, timezone)}</p></Card>
            <Card><p className="text-xs uppercase text-muted">Ventes espèces</p><p className="text-2xl font-bold"><Money amount={s.summary.cashSales} /></p><p className="text-xs text-muted">remb. <Money amount={s.summary.cashRefunds} /></p></Card>
            <Card><p className="text-xs uppercase text-muted">Entrées / sorties</p><p className="text-2xl font-bold"><Money amount={s.summary.payIns + s.summary.payOuts + s.summary.deposits + s.summary.corrections} /></p></Card>
            <section className="rounded-2xl border border-lagon-700 bg-lagon-600 p-4 text-white"><p className="text-xs uppercase opacity-80">Espèces théoriques</p><p className="text-2xl font-bold"><Money amount={s.summary.cashExpected} /></p></section>
          </div>
          <div className="flex flex-wrap gap-2">
            {can("cash.movement") || can("cash.correct") ? <Button size="lg" variant="secondary" onClick={() => setDialog("movement")}>Entrée / sortie d&apos;espèces</Button> : null}
            {can("cash.close") ? <Button size="lg" variant="accent" onClick={() => setDialog("close")}>Clôturer la caisse</Button> : null}
            <DrawerButton />
            {online ? <a className="touch inline-flex h-14 items-center rounded-xl border border-line px-6 text-base font-semibold" href={`/api/cash/${s.session.id}/report`} target="_blank" rel="noreferrer">Rapport X (impression)</a> : <span className="inline-flex h-14 items-center rounded-xl bg-amber-500/10 px-4 text-sm font-semibold text-amber-700 dark:text-amber-300">Hors ligne : chiffres tenus sur cette tablette, rapport à la reconnexion</span>}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Ventes par moyen de paiement">
              {Object.entries(s.summary.byMethod).length === 0 ? <p className="text-sm text-muted">Aucun encaissement</p> : null}
              {Object.entries(s.summary.byMethod).map(([m, v]) => <div key={m} className="flex justify-between border-b border-line py-1.5 text-sm last:border-0"><span>{PAYMENT_LABEL[m]} <span className="text-muted">× {v.count}</span></span><span className="font-semibold"><Money amount={v.amount - v.refunded} /></span></div>)}
              <div className="mt-2 flex justify-between border-t border-line pt-2 font-bold"><span>Total encaissé</span><Money amount={s.summary.totalSales} /></div>
            </Card>
            <Card title="Mouvements">
              <div className="max-h-80 overflow-y-auto">
                {s.session.movements.map((m) => <div key={m.id} className="flex justify-between border-b border-line py-1.5 text-sm last:border-0"><span><span className="font-semibold">{KIND_LABEL[m.kind]}</span> <span className="text-muted">{m.reason ?? ""} · {formatDateTime(m.createdAt, timezone)}</span></span><span className={`font-semibold ${m.amount < 0 ? "text-red-600" : ""}`}><Money amount={m.amount} /></span></div>)}
              </div>
            </Card>
          </div>
        </>
      )}

      <Modal open={dialog === "open"} onClose={() => setDialog(null)} title="Ouvrir la caisse" size="sm">
        <p className="mb-2 text-center text-xs uppercase text-muted">Fond de caisse</p>
        <p className="mb-3 text-center text-3xl font-bold"><Money amount={Number(amount || 0)} /></p>
        <div className="mb-2 grid grid-cols-3 gap-2">{[10000, 20000, 30000].map((v) => <button key={v} onClick={() => setAmount(String(v))} className="touch h-10 rounded-lg surface-2 text-sm font-bold"><Money amount={v} /></button>)}</div>
        <NumPad value={amount} onChange={setAmount} onSubmit={(() => { const id = crypto.randomUUID(); const openingFloat = Number(amount || 0); return wrap(() => api.post("/api/cash/open", { id, openingFloat }, { idempotencyKey: id, queueIfOffline: true }), async () => { await openCashLocal(id, openingFloat, userName); toast("Hors ligne : caisse ouverte sur cette tablette, transmise à la reconnexion", "info"); }); })()} submitLabel="Ouvrir" disabled={loading} />
      </Modal>

      <Modal open={dialog === "movement"} onClose={() => setDialog(null)} title="Mouvement d'espèces" size="sm">
        <div className="mb-3 grid grid-cols-2 gap-2">
          {([["PAY_IN", "Entrée"], ["PAY_OUT", "Sortie"], ["DEPOSIT", "Dépôt banque"], ["CORRECTION", "Correction (manager)"]] as const).map(([k, l]) => <button key={k} onClick={() => setKind(k)} className={`touch h-11 rounded-lg text-sm font-bold ${kind === k ? "bg-lagon-600 text-white" : "surface-2"}`}>{l}</button>)}
        </div>
        <p className="mb-2 text-center text-3xl font-bold">{kind === "CORRECTION" && amount.startsWith("-") ? "−" : ""}<Money amount={Math.abs(Number(amount || 0))} /></p>
        <NumPad value={amount.replace("-", "")} onChange={(v) => setAmount((amount.startsWith("-") ? "-" : "") + v)} extraKeys={kind === "CORRECTION" ? [{ label: "±", onPress: () => setAmount(amount.startsWith("-") ? amount.slice(1) : "-" + amount) }] : undefined} />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif (obligatoire)" className="mt-3 h-11 w-full rounded-xl border border-line surface px-3 text-sm" />
        <Button className="mt-3 w-full" size="lg" loading={loading} disabled={!reason || Number(amount) === 0} onClick={wrap(() => withPin(setPin, kind === "CORRECTION" ? "cash.correct" : "cash.movement", (managerPin) => api.post(`/api/cash/${s?.session.id}/movements`, { kind, amount: Number(amount), reason, managerPin })), async () => { await addCashMovementLocal(kind, Number(amount), reason, userName); toast("Hors ligne : mouvement enregistré, transmis à la reconnexion", "info"); })}>Enregistrer</Button>
      </Modal>

      <Modal open={dialog === "close"} onClose={() => setDialog(null)} title="Clôturer la caisse" size="sm">
        <div className="mb-3 rounded-xl surface-2 p-3 text-sm"><div className="flex justify-between"><span>Espèces théoriques</span><strong><Money amount={s?.summary.cashExpected ?? 0} /></strong></div><div className="flex justify-between"><span>Espèces comptées</span><strong><Money amount={Number(amount || 0)} /></strong></div><div className={`flex justify-between font-bold ${Number(amount || 0) - (s?.summary.cashExpected ?? 0) === 0 ? "text-green-600" : "text-red-600"}`}><span>Écart</span><Money amount={Number(amount || 0) - (s?.summary.cashExpected ?? 0)} /></div></div>
        <NumPad value={amount} onChange={setAmount} />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Commentaire (facultatif)" className="mt-3 h-11 w-full rounded-xl border border-line surface px-3 text-sm" />
        <Button variant="accent" className="mt-3 w-full" size="lg" loading={loading} disabled={amount === ""} onClick={wrap(async () => { await api.post(`/api/cash/${s?.session.id}/close`, { countedCash: Number(amount), notes: reason || null }, { queueIfOffline: true }); toast("Caisse clôturée", "success"); }, async () => {
          const r = await closeCashLocal(Number(amount));
          toast(`Hors ligne : caisse clôturée sur cette tablette (écart ${r.difference > 0 ? "+" : ""}${r.difference} F). Le rapport définitif est calculé à la reconnexion.`, "info");
        })}>Confirmer la clôture</Button>
      </Modal>
      <PinModal request={pin} onClose={() => setPin(null)} />
    </div>
  );
}

const DRAWER_REASONS = ["Faire de la monnaie", "Erreur de rendu", "Vérification du fond"];

/** Ouverture du tiroir sans vente : visible seulement si un tiroir est configuré et que le rôle le permet ; motif tracé dans le journal d'audit. */
function DrawerButton() {
  const { toast } = useToast();
  const { can } = useSession();
  const allowed = can("pos.open_drawer");
  const { me } = useSession();
  const drawer = useQuery({ queryKey: ["drawer"], queryFn: () => api.get<{ available: boolean }>("/api/hardware/drawer"), enabled: allowed, staleTime: 60_000 });
  const printers = (usePosCatalog(allowed).data?.printers ?? []) as LocalPrinter[];
  // Sans internet : tiroir branché sur une imprimante de l'agent local
  const localDrawer = printers.some((p) => p.hasDrawer && p.driver === "agent" && p.agentUrl);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  if (!allowed || !(drawer.data?.available || localDrawer)) return null;
  const go = async () => {
    setBusy(true);
    try { await reportPrint(await api.post<PrintResult>("/api/hardware/drawer", { reason: reason.trim() || null }), toast, "Tiroir-caisse"); setOpen(false); setReason(""); }
    catch (e) {
      const offline = e instanceof ApiClientError && e.isNetwork;
      if (offline && localDrawer) {
        try { await openDrawerLocal(printers, me?.terminal?.id); toast("Tiroir ouvert (hors ligne, par l'agent d'impression)", "success"); setOpen(false); setReason(""); }
        catch { toast("Agent d'impression injoignable depuis cet appareil", "error"); }
      } else toast(e instanceof ApiClientError ? e.message : "Ouverture impossible", "error");
    }
    finally { setBusy(false); }
  };
  return (
    <>
      <Button size="lg" variant="secondary" onClick={() => setOpen(true)}><Archive className="h-5 w-5 text-amber-600" />Ouvrir le tiroir</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Ouvrir le tiroir-caisse" size="sm" footer={<Button size="lg" className="w-full" loading={busy} onClick={go}><Archive className="h-5 w-5" />Ouvrir le tiroir</Button>}>
        <p className="mb-3 text-sm text-muted">Ouverture sans vente : elle est enregistrée dans le journal d&apos;audit avec votre nom et le motif.</p>
        <div className="mb-3 flex flex-wrap gap-2">{DRAWER_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={`touch rounded-full px-3 py-1.5 text-sm font-semibold ${reason === r ? "bg-brand text-white" : "surface-2"}`}>{r}</button>)}</div>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Motif (facultatif)" aria-label="Motif" className="h-12 w-full rounded-xl border border-line surface px-3 text-base outline-none focus:border-lagon-500 focus:ring-4 focus:ring-lagon-500/15" />
      </Modal>
    </>
  );
}
