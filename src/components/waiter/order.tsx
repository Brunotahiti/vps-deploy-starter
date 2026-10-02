"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Minus, Pencil, Plus, Search, Send, Trash2, X } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { usePosCatalog } from "@/components/pos/use-catalog";
import { ProductModal, type ProductChoice } from "@/components/pos/product-modal";
import { PinModal, withPin, type PinRequest } from "@/components/pos/pin-modal";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { Photo } from "@/components/ui/photo";
import { useToast } from "@/components/ui/toast";
import { courseLabel } from "@/lib/meal-stage";
import type { Order, OrderItem, PosMenu, PosProduct } from "@/components/pos/types";
import type { DishStage } from "@/server/services/kitchen-changes";
import type { KitchenChange } from "@/components/kds/types";

type KitchenState = { stages: Record<string, DishStage | null>; changes: KitchenChange[] };

/** Statut d'un plat envoyé, tel que la salle le voit */
export const STAGE: Record<DishStage, { label: string; dot: string; chip: string }> = {
  NEW: { label: "Nouvelle", dot: "🟡", chip: "bg-yellow-400/20 text-yellow-800 dark:text-yellow-200" },
  ACCEPTED: { label: "Acceptée", dot: "🔵", chip: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  PREPARING: { label: "En préparation", dot: "🟠", chip: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  READY: { label: "Prête", dot: "🟢", chip: "bg-green-500/20 text-green-700 dark:text-green-300" },
  SERVED: { label: "Servie", dot: "⚫", chip: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
};
const CHANGE_STATUS: Record<string, { label: string; chip: string }> = {
  REQUESTED: { label: "⏳ Envoyée à la cuisine", chip: "bg-amber-500/15 text-amber-800 dark:text-amber-200" },
  SEEN: { label: "👀 Vue par la cuisine", chip: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  APPLIED: { label: "✅ Appliquée", chip: "bg-green-500/15 text-green-700 dark:text-green-300" },
};
const CANCEL_REASONS = ["Le client a changé d'avis", "Erreur de saisie", "Trop d'attente", "Plat non conforme"];

/**
 * Prise de commande sur téléphone : la carte en grandes vignettes, la commande par service, l'envoi en cuisine
 * d'un geste, puis le suivi plat par plat (🟡 Nouvelle → 🔵 Acceptée → 🟠 En préparation → 🟢 Prête → ⚫ Servie).
 * Modifier ou annuler un plat envoyé prévient la cuisine ; s'il est déjà en préparation, on confirme d'abord.
 */
export function WaiterOrder({ orderId }: { orderId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useQuery({ queryKey: ["order", orderId], queryFn: () => api.get<Order>(`/api/orders/${orderId}`), refetchInterval: 15_000 });
  const kitchen = useQuery({ queryKey: ["order", orderId, "kitchen"], queryFn: () => api.get<KitchenState>(`/api/orders/${orderId}/kitchen`), refetchInterval: 10_000 });
  const catalog = usePosCatalog();
  const [tab, setTab] = useState<"menu" | "order">("menu");
  const [courseId, setCourseId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [picker, setPicker] = useState<{ product?: PosProduct; menu?: PosMenu } | null>(null);
  const [modifying, setModifying] = useState<OrderItem | null>(null);
  const [cancelling, setCancelling] = useState<OrderItem | null>(null);
  const [pin, setPin] = useState<PinRequest>(null);
  const [burst, setBurst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  const o = q.data;
  const refresh = () => { qc.invalidateQueries({ queryKey: ["order", orderId] }); qc.invalidateQueries({ queryKey: ["floor"] }); };
  const fail = (e: unknown) => { if (!(e instanceof ApiClientError && (e.isPinRequired || e.code === "PIN_CANCELLED"))) toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); };
  const defaultCourse = o ? (o.courses.find((c) => /plat/i.test(c.name)) ?? o.courses[o.courses.length > 1 ? 1 : 0])?.id ?? null : null;
  const course = courseId ?? defaultCourse;

  const add = async (choice: ProductChoice) => {
    const id = crypto.randomUUID();
    try {
      await api.post(`/api/orders/${orderId}/items`, { ...choice, id, courseId: course }, { idempotencyKey: id });
      const name = choice.productId ? catalog.data?.products.find((p) => p.id === choice.productId)?.name : catalog.data?.menus.find((m) => m.id === choice.menuId)?.name;
      setAdded(name ?? "Ajouté");
      setTimeout(() => setAdded(null), 1200);
      try { navigator.vibrate?.(30); } catch {}
      refresh();
    } catch (e) { fail(e); }
  };
  const tapProduct = (p: PosProduct) => {
    const needsChoice = p.variants.length > 0 || p.modifierGroups.some((g) => g.modifiers.length > 0);
    if (needsChoice) setPicker({ product: p });
    else add({ productId: p.id, quantity: 1 });
  };
  const send = async () => {
    setBusy(true);
    try {
      await api.post(`/api/orders/${orderId}/send`, { all: true });
      setBurst(true); setTimeout(() => setBurst(false), 1600);
      try { navigator.vibrate?.([40, 60, 40]); } catch {}
      refresh(); setTab("order");
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };
  const changeQty = async (i: OrderItem, qty: number) => {
    try {
      if (qty <= 0) await api.delete(`/api/orders/${orderId}/items/${i.id}`, { reason: null });
      else await api.patch(`/api/orders/${orderId}/items/${i.id}`, { quantity: qty });
      refresh();
    } catch (e) { fail(e); }
  };
  const served = async (cid: string) => {
    try { await api.post(`/api/orders/${orderId}/courses/${cid}`, { status: "SERVED" }); toast("Bon appétit ! 😋", "success"); refresh(); } catch (e) { fail(e); }
  };

  const products = useMemo(() => {
    const all = (catalog.data?.products ?? []).filter((p) => p.isAvailable && !p.autoUnavailable);
    const n = search.trim().toLowerCase();
    if (n) return all.filter((p) => p.name.toLowerCase().includes(n));
    const cat = category ?? catalog.data?.categories[0]?.id ?? null;
    return all.filter((p) => p.categoryId === cat);
  }, [catalog.data, category, search]);

  if (q.isLoading || !o) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  const live = o.items.filter((i) => i.status !== "VOIDED" && !i.parentItemId);
  const pending = live.filter((i) => i.status === "PENDING");
  const stageOf = (i: OrderItem) => kitchen.data?.stages[i.id] ?? null;
  const changesOf = (i: OrderItem) => (kitchen.data?.changes ?? []).filter((c) => c.orderItemId === i.id);
  const closed = o.status === "PAID" || o.status === "CANCELLED";
  const activeCat = category ?? catalog.data?.categories[0]?.id ?? null;

  return (
    <div className="flex h-full flex-col" data-testid="waiter-order">
      {/* En-tête */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line surface px-3 py-2.5">
        <Link href="/pos/m" className="touch flex h-11 w-11 items-center justify-center rounded-2xl surface-2" aria-label="Mes tables"><ArrowLeft className="h-5 w-5" /></Link>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-extrabold leading-tight">{o.table ? `Table ${o.table.name}` : "Commande"}</p>
          <p className="text-xs text-muted">{o.covers} pers. · n° {o.number.split("-").pop()}</p>
        </div>
        <p className="text-lg font-extrabold"><Money amount={o.total} /></p>
      </div>
      <div className="flex gap-1 surface-2 p-1">
        {([["menu", "🍽️ La carte"], ["order", `🧾 La commande${live.length ? ` (${live.length})` : ""}`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`touch h-11 flex-1 rounded-xl text-sm font-extrabold ${tab === k ? "surface shadow-sm" : "text-muted"}`}>{l}</button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "menu" ? (
          <div className="px-3 pb-28 pt-3">
            {/* Service du plat ajouté */}
            <div className="mb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
              {o.courses.map((c) => <button key={c.id} onClick={() => setCourseId(c.id)} className={`touch h-9 shrink-0 rounded-full px-4 text-xs font-extrabold ${course === c.id ? "bg-nuit-900 text-white dark:bg-white dark:text-nuit-900" : "surface-2 text-muted"}`}>{courseLabel(c.name)}</button>)}
            </div>
            <label className="relative mb-2 block"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input aria-label="Chercher un plat" placeholder="Chercher un plat…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 w-full rounded-2xl border border-line surface pl-9 pr-3 text-sm outline-none focus:border-lagon-500" /></label>
            {!search ? (
              <div className="mb-3 flex gap-1.5 overflow-x-auto no-scrollbar">
                {(catalog.data?.categories ?? []).map((c) => <button key={c.id} onClick={() => setCategory(c.id)} className={`touch h-10 shrink-0 rounded-2xl px-4 text-sm font-bold ${activeCat === c.id ? "text-white shadow-glow" : "card"}`} style={activeCat === c.id ? { background: c.color ?? "var(--brand)" } : undefined}>{c.name}</button>)}
                {catalog.data?.menus.length ? <button onClick={() => setCategory("__menus")} className={`touch h-10 shrink-0 rounded-2xl px-4 text-sm font-bold ${activeCat === "__menus" ? "bg-brand text-white" : "card"}`}>Formules</button> : null}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2.5">
              {activeCat === "__menus" && !search
                ? (catalog.data?.menus ?? []).map((m) => (
                  <button key={m.id} onClick={() => setPicker({ menu: m })} className="touch card flex min-h-[96px] flex-col justify-between p-3 text-left active:scale-[0.97]">
                    <span className="font-extrabold leading-tight">{m.name}</span><span className="font-bold text-lagon-700 dark:text-lagon-300"><Money amount={m.priceTtc} /></span>
                  </button>))
                : products.map((p) => (
                  <button key={p.id} onClick={() => tapProduct(p)} data-testid="waiter-product" className="touch card relative flex flex-col overflow-hidden text-left active:scale-[0.97]">
                    <Photo src={p.imageUrl} className="h-24 w-full object-cover" fallback={<div className="flex h-24 w-full items-center justify-center text-3xl" style={{ background: `color-mix(in srgb, ${p.color ?? "#14aaa3"} 18%, transparent)` }}>🍽️</div>} />
                    <span className="px-2.5 pt-2 text-sm font-extrabold leading-tight">{p.name}</span>
                    <span className="flex items-center justify-between px-2.5 pb-2.5 pt-1"><span className="text-sm font-bold text-lagon-700 dark:text-lagon-300"><Money amount={p.priceTtc} /></span><span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-white shadow-glow"><Plus className="h-4 w-4" /></span></span>
                  </button>
                ))}
            </div>
            {!products.length && activeCat !== "__menus" ? <p className="py-10 text-center text-sm text-muted">Aucun plat ici</p> : null}
          </div>
        ) : (
          <div className="space-y-4 px-3 pb-28 pt-3">
            {!live.length ? <div className="py-16 text-center"><p className="text-4xl">🍽️</p><p className="mt-2 font-bold">Rien pour l&apos;instant</p><button onClick={() => setTab("menu")} className="mt-3 font-bold text-lagon-700 underline">Ouvrir la carte</button></div> : null}
            {o.courses.map((c) => {
              const items = live.filter((i) => i.courseId === c.id);
              if (!items.length) return null;
              const readyHere = items.some((i) => stageOf(i) === "READY");
              return (
                <section key={c.id}>
                  <div className="mb-1.5 flex items-center justify-between px-1">
                    <p className="text-sm font-extrabold uppercase tracking-wide text-muted">{courseLabel(c.name)}</p>
                    {readyHere && !closed ? <Button size="sm" onClick={() => served(c.id)} className="bg-green-600!">✓ Apporté à la table</Button> : null}
                  </div>
                  <div className="space-y-2">{items.map((i) => {
                    const st = stageOf(i);
                    const changes = changesOf(i);
                    return (
                      <div key={i.id} className="card p-3" data-testid="waiter-item">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-extrabold leading-tight">{i.quantity} × {i.name}</p>
                            {i.modifiers.length ? <p className="text-xs font-semibold text-lagon-700 dark:text-lagon-300">{i.modifiers.map((m) => m.name).join(" · ")}</p> : null}
                            {i.notes ? <p className="text-xs italic text-corail-500">« {i.notes} »</p> : null}
                          </div>
                          <span className="text-sm font-bold"><Money amount={i.lineTotal} /></span>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {i.status === "PENDING" ? (
                            <>
                              <span className="rounded-full surface-2 px-2.5 py-1 text-[11px] font-extrabold text-muted">À envoyer</span>
                              {!closed ? <span className="ml-auto flex items-center gap-1">
                                <button onClick={() => changeQty(i, i.quantity - 1)} className="touch flex h-9 w-9 items-center justify-center rounded-xl surface-2" aria-label="Un de moins">{i.quantity > 1 ? <Minus className="h-4 w-4" /> : <Trash2 className="h-4 w-4 text-red-600" />}</button>
                                <button onClick={() => changeQty(i, i.quantity + 1)} className="touch flex h-9 w-9 items-center justify-center rounded-xl surface-2" aria-label="Un de plus"><Plus className="h-4 w-4" /></button>
                              </span> : null}
                            </>
                          ) : st ? (
                            <>
                              <span data-testid="dish-stage" className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${STAGE[st].chip}`}>{STAGE[st].dot} {STAGE[st].label}</span>
                              {!closed && st !== "SERVED" ? <span className="ml-auto flex gap-1">
                                {i.productId ? <button onClick={() => setModifying(i)} className="touch flex h-9 items-center gap-1 rounded-xl surface-2 px-3 text-xs font-bold"><Pencil className="h-3.5 w-3.5" />Modifier</button> : null}
                                <button onClick={() => setCancelling(i)} className="touch flex h-9 items-center gap-1 rounded-xl bg-red-500/10 px-3 text-xs font-bold text-red-700 dark:text-red-300"><X className="h-3.5 w-3.5" />Annuler</button>
                              </span> : null}
                            </>
                          ) : null}
                        </div>
                        {changes.length ? (
                          <ul className="mt-2 space-y-1 border-t border-line pt-2">{changes.map((ch) => (
                            <li key={ch.id} className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="waiter-change">
                              <span className="font-bold">{ch.kind === "CANCEL" ? "Annulation" : "Modification"}{ch.urgent ? " urgente" : ""} :</span>
                              <span className="text-muted">{[...ch.removed.map((r) => `❌ ${r}`), ...ch.added.map((a) => `➕ ${a}`), ch.note ? `« ${ch.note} »` : null, ch.reason].filter(Boolean).join(" · ")}</span>
                              <span className={`ml-auto rounded-full px-2 py-0.5 font-extrabold ${CHANGE_STATUS[ch.status].chip}`}>{CHANGE_STATUS[ch.status].label}</span>
                            </li>
                          ))}</ul>
                        ) : null}
                      </div>
                    );
                  })}</div>
                </section>
              );
            })}
            {o.items.some((i) => i.status === "VOIDED" && !i.parentItemId) ? (
              <section><p className="mb-1.5 px-1 text-sm font-extrabold uppercase tracking-wide text-muted">Annulés</p>
                <div className="space-y-1">{o.items.filter((i) => i.status === "VOIDED" && !i.parentItemId).map((i) => <p key={i.id} className="card px-3 py-2 text-sm text-muted line-through">{i.quantity} × {i.name}{i.voidReason ? ` · ${i.voidReason}` : ""}</p>)}</div>
              </section>
            ) : null}
          </div>
        )}
      </div>

      {/* Envoi en cuisine */}
      {pending.length && !closed ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-4">
          <button onClick={send} disabled={busy} data-testid="send-kitchen" className="touch pointer-events-auto flex h-16 w-full max-w-md items-center justify-center gap-3 rounded-3xl bg-gradient-to-r from-orange-500 to-corail-500 text-lg font-extrabold text-white shadow-[0_16px_40px_-12px_rgb(249_124_60/0.9)] active:scale-[0.98] disabled:opacity-60">
            <Send className="h-6 w-6" />Envoyer en cuisine <span className="rounded-full bg-white/25 px-2.5 py-0.5 text-base">{pending.reduce((a, i) => a + i.quantity, 0)}</span>
          </button>
        </div>
      ) : null}
      {added ? <div className="pointer-events-none fixed inset-x-0 top-24 z-30 flex justify-center"><span className="rise rounded-full bg-nuit-900 px-4 py-2 text-sm font-bold text-white shadow-lift">➕ {added}</span></div> : null}
      {burst ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center bg-white/60 backdrop-blur-sm dark:bg-black/50" data-testid="sent-burst">
          <p className="rise text-7xl">👨‍🍳</p><p className="rise mt-3 text-2xl font-extrabold">C&apos;est parti en cuisine !</p>
        </div>
      ) : null}

      {picker ? <ProductModal product={picker.product ?? null} menu={picker.menu ?? null} products={catalog.data?.products ?? []} onClose={() => setPicker(null)} onAdd={async (c) => { await add(c); setPicker(null); }} /> : null}
      {modifying ? <ModifySheet orderId={orderId} item={modifying} stage={stageOf(modifying)} product={catalog.data?.products.find((p) => p.id === modifying.productId) ?? null} onClose={() => setModifying(null)} onDone={() => { setModifying(null); refresh(); }} onError={fail} /> : null}
      {cancelling ? <CancelSheet item={cancelling} stage={stageOf(cancelling)} onClose={() => setCancelling(null)} onConfirm={async (reason) => {
        const item = cancelling;
        await withPin(setPin, "pos.void_item", (managerPin) => api.delete(`/api/orders/${orderId}/items/${item.id}`, { reason, managerPin }))
          .then(() => { toast("Annulation envoyée à la cuisine", "success"); setCancelling(null); refresh(); })
          .catch(fail);
      }} /> : null}
      <PinModal request={pin} onClose={() => setPin(null)} />
    </div>
  );
}

/** Modifier un plat envoyé : options retirées ❌ ou ajoutées ➕, note ; confirmation s'il est déjà en préparation. */
function ModifySheet({ orderId, item, stage, product, onClose, onDone, onError }: { orderId: string; item: OrderItem; stage: DishStage | null; product: PosProduct | null; onClose: () => void; onDone: () => void; onError: (e: unknown) => void }) {
  const [selected, setSelected] = useState<string[]>(() => item.modifiers.map((m) => m.modifierId).filter((x): x is string => !!x));
  const [note, setNote] = useState(item.notes ?? "");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const groups = product?.modifierGroups ?? [];
  const nameOf = (id: string) => groups.flatMap((g) => g.modifiers).find((m) => m.id === id)?.name ?? "";
  const before = item.modifiers.map((m) => m.modifierId).filter((x): x is string => !!x);
  const removed = before.filter((id) => !selected.includes(id));
  const added = selected.filter((id) => !before.includes(id));
  const changed = removed.length > 0 || added.length > 0 || (note.trim() || null) !== (item.notes ?? null);
  const urgent = stage === "PREPARING" || stage === "READY";
  const toggle = (g: (typeof groups)[number], id: string) => setSelected((cur) => {
    if (cur.includes(id)) return cur.filter((x) => x !== id);
    const inGroup = g.modifiers.map((m) => m.id);
    const next = g.maxSelect === 1 ? cur.filter((x) => !inGroup.includes(x)) : cur;
    return [...next, id];
  });
  const submit = async () => {
    if (urgent && !confirm) { setConfirm(true); return; }
    setBusy(true);
    try { await api.post(`/api/orders/${orderId}/items/${item.id}/modify`, { modifiers: selected.map((modifierId) => ({ modifierId })), note: note.trim() || null }); onDone(); }
    catch (e) { onError(e); setConfirm(false); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Modifier · ${item.name}`} size="md" footer={
      confirm ? (
        <div className="space-y-2" data-testid="confirm-modify">
          <p className="rounded-2xl bg-amber-500/15 p-3 text-sm font-bold text-amber-800 dark:text-amber-200">⚠️ Le plat est déjà {stage === "READY" ? "prêt" : "en préparation"}. Confirmer la modification ?</p>
          <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setConfirm(false)}>Retour</Button><Button className="flex-1" loading={busy} onClick={submit}>Oui, prévenir la cuisine</Button></div>
        </div>
      ) : <Button size="lg" className="w-full" disabled={!changed} loading={busy} onClick={submit}>Envoyer la modification à la cuisine</Button>
    }>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.id}>
            <p className="mb-1.5 text-xs font-extrabold uppercase tracking-wide text-muted">{g.name}</p>
            <div className="flex flex-wrap gap-1.5">{g.modifiers.map((m) => {
              const on = selected.includes(m.id);
              const was = before.includes(m.id);
              return <button key={m.id} aria-pressed={on} onClick={() => toggle(g, m.id)} className={`touch h-11 rounded-2xl border px-3 text-sm font-bold ${on ? "border-transparent bg-brand text-white" : was ? "border-red-400 text-red-600 line-through" : "border-line surface"}`}>{on && !was ? "➕ " : !on && was ? "❌ " : ""}{m.name}</button>;
            })}</div>
          </div>
        ))}
        <label className="block"><span className="mb-1.5 block text-xs font-extrabold uppercase tracking-wide text-muted">Note pour la cuisine</span>
          <input aria-label="Note pour la cuisine" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. sans sauce, bien cuit…" className="h-12 w-full rounded-2xl border border-line surface px-3 text-base outline-none focus:border-lagon-500" />
        </label>
        {changed ? (
          <div className="rounded-2xl surface-2 p-3 text-sm" data-testid="modify-summary">
            <p className="mb-1 font-extrabold">La cuisine recevra : {urgent ? "🚨 MODIFICATION URGENTE" : "🔴 MODIFICATION"}</p>
            {removed.map((id) => <p key={id} className="font-bold text-red-600">❌ Sans {nameOf(id)}</p>)}
            {added.map((id) => <p key={id} className="font-bold text-green-700 dark:text-green-400">➕ {nameOf(id)}</p>)}
            {(note.trim() || null) !== (item.notes ?? null) && note.trim() ? <p className="italic">« {note.trim()} »</p> : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/** Annuler un plat envoyé : motif, confirmation s'il est déjà préparé ; la cuisine et la caisse sont prévenues. */
function CancelSheet({ item, stage, onClose, onConfirm }: { item: OrderItem; stage: DishStage | null; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [other, setOther] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const late = stage === "PREPARING" || stage === "READY";
  const motive = reason === "Autre" ? other.trim() : reason;
  const go = async () => {
    if (late && !confirm) { setConfirm(true); return; }
    setBusy(true);
    await onConfirm(motive).finally(() => setBusy(false));
  };
  return (
    <Modal open onClose={onClose} title={`Annuler · ${item.quantity} × ${item.name}`} size="sm" footer={
      confirm ? (
        <div className="space-y-2" data-testid="confirm-cancel">
          <p className="rounded-2xl bg-red-500/10 p-3 text-sm font-bold text-red-700 dark:text-red-300">⚠️ Plat déjà {stage === "READY" ? "préparé" : "en préparation"}. Voulez-vous quand même demander l&apos;annulation ?</p>
          <div className="flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => setConfirm(false)}>Non</Button><Button variant="danger" className="flex-1" loading={busy} onClick={go}>Oui, annuler</Button></div>
        </div>
      ) : <Button size="lg" variant="danger" className="w-full" disabled={!motive} loading={busy} onClick={go}>Demander l&apos;annulation</Button>
    }>
      <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-muted">Motif</p>
      <div className="flex flex-wrap gap-1.5">{[...CANCEL_REASONS, "Autre"].map((r) => <button key={r} aria-pressed={reason === r} onClick={() => setReason(r)} className={`touch h-11 rounded-2xl border px-3 text-sm font-bold ${reason === r ? "border-transparent bg-nuit-900 text-white dark:bg-white dark:text-nuit-900" : "border-line surface"}`}>{r}</button>)}</div>
      {reason === "Autre" ? <input aria-label="Autre motif" autoFocus value={other} onChange={(e) => setOther(e.target.value)} placeholder="Précisez…" className="mt-2 h-12 w-full rounded-2xl border border-line surface px-3 text-base outline-none" /> : null}
    </Modal>
  );
}
