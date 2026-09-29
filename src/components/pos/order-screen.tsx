"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Search, Send, Receipt, CreditCard, Percent, XCircle, ArrowRightLeft, Printer, Flame, PauseCircle, CheckCircle2, AlertTriangle, ChevronDown, Plus, X, ShoppingBasket } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { Money } from "@/components/money";
import { formatElapsed } from "@/lib/dates";
import { useSession } from "@/hooks/use-session";
import { usePosCatalog } from "./use-catalog";
import { ProductModal, type ProductChoice } from "./product-modal";
import { ItemModal } from "./item-modal";
import { PaymentModal, type PaymentPayload } from "./payment-modal";
import { PinModal, withPin, type PinRequest } from "./pin-modal";
import { ReceiptDialog } from "./receipt-dialog";
import { useFloor } from "./floor";
import { useOffline } from "@/lib/offline/provider";
import { getLocalOrder, markOfflineOrderClosed, saveLocalOrder } from "@/lib/offline/local-orders";
import { computeOrderTotals } from "@/lib/order-calc";
import { ORDER_TYPE_LABEL, type Order, type OrderItem, type PosMenu, type PosProduct } from "./types";
import { NumPad } from "@/components/ui/numpad";

const FORMULES = "__menus__";

/** Recalcule les totaux d'une commande modifiée localement (même logique que le serveur). */
function recomputeLocal(o: Order): Order {
  const t = computeOrderTotals(o.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, modifiersTotal: i.modifiersTotal, discountAmount: i.discountAmount, taxRateBps: i.taxRateBps, taxRateName: i.taxRateName, voided: i.status === "VOIDED" })), o.discountTotal);
  return { ...o, subtotal: t.subtotal, discountTotal: t.discountTotal, taxTotal: t.taxTotal, total: t.total };
}

export function OrderScreen({ orderId: orderIdProp }: { orderId: string }) {
  // Hors ligne, la page peut être servie depuis un shell générique : l'id réel est dans l'URL
  const [orderId] = useState(() => (typeof window !== "undefined" ? window.location.pathname.split("/pos/order/")[1]?.split(/[/?#]/)[0] || orderIdProp : orderIdProp));
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = useSession();
  const catalog = usePosCatalog();
  const { online } = useOffline();
  const order = useQuery({
    queryKey: ["order", orderId],
    refetchInterval: online ? 15_000 : false,
    queryFn: async () => {
      try {
        const o = await api.get<Order>(`/api/orders/${orderId}`);
        if (o.status === "OPEN" || o.status === "SENT" || o.status === "BILL_REQUESTED") saveLocalOrder(o).catch(() => {});
        return o;
      } catch (e) {
        const local = await getLocalOrder(orderId);
        if (local) return local;
        throw e;
      }
    },
  });
  const [search, setSearch] = useState("");
  const [seat, setSeat] = useState<number | null>(null);
  const [productOpen, setProductOpen] = useState<PosProduct | null>(null);
  const [menuOpen, setMenuOpen] = useState<PosMenu | null>(null);
  const [itemOpen, setItemOpen] = useState<OrderItem | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [pin, setPin] = useState<PinRequest>(null);
  const [dialog, setDialog] = useState<"discount" | "cancel" | "transfer" | "covers" | null>(null);
  const [receipt, setReceipt] = useState<{ afterPayment: boolean } | null>(null);
  const [sendMenu, setSendMenu] = useState(false);
  const [sheet, setSheet] = useState(false); // panneau « commande » sur téléphone

  const o = order.data;
  const [courseSel, setCourseSel] = useState<string | null>(null);
  const [categorySel, setCategorySel] = useState<string | null>(null);
  const courseId = courseSel ?? (o ? (o.courses.find((c) => c.status === "PENDING") ?? o.courses[0])?.id ?? null : null);
  const categoryId = categorySel ?? catalog.data?.categories[0]?.id ?? null;
  const setCourseId = setCourseSel;
  const setCategoryId = setCategorySel;

  const setOrder = useCallback((next: Order) => { qc.setQueryData(["order", orderId], next); saveLocalOrder(next).catch(() => {}); }, [qc, orderId]);
  /** Applique une modification locale (hors ligne) au ticket en recalculant les totaux. */
  const patchLocal = useCallback((fn: (o: Order) => Order) => { const cur = qc.getQueryData<Order>(["order", orderId]); if (cur) setOrder(recomputeLocal(fn(cur))); }, [qc, orderId, setOrder]);
  const invalidate = useCallback(() => { qc.invalidateQueries({ queryKey: ["order", orderId] }); qc.invalidateQueries({ queryKey: ["floor"] }); qc.invalidateQueries({ queryKey: ["orders"] }); }, [qc, orderId]);

  const isQueued = (e: unknown) => e instanceof ApiClientError && e.code === "QUEUED";
  const onError = (e: unknown) => {
    if (isQueued(e)) toast("Hors ligne : opération enregistrée, elle sera synchronisée", "info");
    else if (!(e instanceof ApiClientError && e.isPinRequired)) toast(e instanceof ApiClientError ? e.message : "Erreur", "error");
  };

  const addItem = useMutation({
    mutationFn: async (choice: ProductChoice & { id: string }) => {
      return api.post<Order>(`/api/orders/${orderId}/items`, { ...choice, courseId, seatNumber: seat }, { idempotencyKey: choice.id, queueIfOffline: true });
    },
    onMutate: async (choice) => {
      // Ajout immédiat (optimiste) dans le ticket
      const current = qc.getQueryData<Order>(["order", orderId]);
      if (!current || !catalog.data) return;
      const p = choice.productId ? catalog.data.products.find((x) => x.id === choice.productId) : null;
      const m = choice.menuId ? catalog.data.menus.find((x) => x.id === choice.menuId) : null;
      const name = p?.name ?? m?.name ?? "…";
      const unitPrice = p ? (choice.variantId ? (p.variants.find((v) => v.id === choice.variantId)?.priceTtc ?? p.priceTtc) : p.priceTtc) : (m?.priceTtc ?? 0);
      const modsTotal = p ? p.modifierGroups.flatMap((g) => g.modifiers).filter((x) => choice.modifiers?.some((s) => s.modifierId === x.id)).reduce((a, x) => a + x.priceDelta, 0) : 0;
      const modNames = p ? p.modifierGroups.flatMap((g) => g.modifiers.filter((x) => choice.modifiers?.some((s) => s.modifierId === x.id)).map((x) => ({ id: crypto.randomUUID(), orderItemId: choice.id, modifierId: x.id, groupName: g.name, name: x.name, priceDelta: x.priceDelta, quantity: 1 }))) : [];
      const temp: OrderItem = { id: choice.id, orderId, courseId, productId: p?.id ?? null, variantId: choice.variantId ?? null, menuId: m?.id ?? null, parentItemId: null, kitchenStationId: p?.kitchenStationId ?? null, kitchenTicketId: null, name, quantity: choice.quantity, unitPrice, modifiersTotal: modsTotal, discountAmount: 0, lineTotal: (unitPrice + modsTotal) * choice.quantity, taxRateBps: p?.taxRate?.rateBps ?? 0, taxRateName: p?.taxRate?.name ?? null, taxAmount: 0, costPrice: 0, seatNumber: seat, notes: choice.notes ?? null, isUrgent: false, status: "PENDING", sentAt: null, readyAt: null, servedAt: null, voidedAt: null, voidReason: null, sortOrder: current.items.length, createdAt: new Date(), updatedAt: new Date(), modifiers: modNames };
      setOrder(recomputeLocal({ ...current, items: [...current.items, temp] }));
    },
    onSuccess: (data) => setOrder(data),
    onError: (e, choice) => { onError(e); if (isQueued(e)) return; const cur = qc.getQueryData<Order>(["order", orderId]); if (cur) setOrder(recomputeLocal({ ...cur, items: cur.items.filter((i) => i.id !== choice.id) })); invalidate(); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["floor"] }),
  });

  const run = async (fn: () => Promise<Order>, local?: (o: Order) => Order) => { try { setOrder(await fn()); } catch (e) { onError(e); if (isQueued(e) && local) patchLocal(local); else if (!isQueued(e)) invalidate(); } };
  const updateItem = (itemId: string, patch: { quantity?: number; seatNumber?: number | null; notes?: string | null; courseId?: string | null; isUrgent?: boolean }) =>
    run(() => api.patch<Order>(`/api/orders/${orderId}/items/${itemId}`, patch, { queueIfOffline: true }), (o) => ({ ...o, items: o.items.map((i) => (i.id === itemId || i.parentItemId === itemId ? { ...i, ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}), ...(patch.seatNumber !== undefined ? { seatNumber: patch.seatNumber } : {}), ...(patch.courseId !== undefined ? { courseId: patch.courseId } : {}), ...(patch.isUrgent !== undefined ? { isUrgent: patch.isUrgent } : {}), ...(i.id === itemId && patch.notes !== undefined ? { notes: patch.notes } : {}) } : i)) }));
  const removeItem = async (item: OrderItem, reason: string | null) => {
    const sent = item.status !== "PENDING";
    await withPin(setPin, "pos.void_item", (managerPin) => api.delete<Order>(`/api/orders/${orderId}/items/${item.id}`, { reason, managerPin }, { queueIfOffline: !sent }).then(setOrder))
      .catch((e) => { onError(e); if (isQueued(e)) patchLocal((o) => ({ ...o, items: o.items.filter((i) => i.id !== item.id && i.parentItemId !== item.id) })); });
    setItemOpen(null);
  };
  const send = (opts: { courseId?: string | null; all?: boolean }) => {
    setSendMenu(false);
    const now = new Date();
    return run(() => api.post<Order>(`/api/orders/${orderId}/send`, opts, { idempotencyKey: crypto.randomUUID(), queueIfOffline: true }),
      (o) => ({ ...o, status: o.status === "OPEN" ? "SENT" : o.status, items: o.items.map((i) => (i.status === "PENDING" && (opts.all || i.courseId === opts.courseId) ? { ...i, status: "SENT", sentAt: now } : i)), courses: o.courses.map((c) => (opts.all || c.id === opts.courseId ? { ...c, status: "SENT", sentAt: now } : c)) }))
      .then(() => toast(online ? "Envoyé en cuisine" : "Envoi enregistré, transmis en cuisine à la reconnexion", online ? "success" : "info"));
  };
  const setCourseStatus = (cid: string, status: "PENDING" | "HOLD" | "FIRE" | "SERVED") => run(() => api.post<Order>(`/api/orders/${orderId}/courses/${cid}`, { status }));
  const requestBill = () => run(() => api.post<Order>(`/api/orders/${orderId}/bill`)).then(() => toast("Addition demandée", "success"));
  const pay = async (payments: PaymentPayload[]) => {
    const body = payments.map((p) => ({ ...p, id: crypto.randomUUID() }));
    await withPin(setPin, "pos.discount", async (managerPin) => {
      const res = await api.post<{ order: Order }>(`/api/orders/${orderId}/payments`, { payments: body, managerPin }, { idempotencyKey: crypto.randomUUID(), queueIfOffline: !body.some((p) => p.method === "COMPLIMENTARY") });
      setOrder(res.order);
      if (res.order.status === "PAID") { setPayOpen(false); toast("Commande soldée ✓", "success"); qc.invalidateQueries({ queryKey: ["floor"] }); qc.invalidateQueries({ queryKey: ["cash"] }); markOfflineOrderClosed(orderId).catch(() => {}); setReceipt({ afterPayment: true }); }
      else toast("Paiement enregistré", "success");
    }).catch((e) => {
      onError(e);
      if (!isQueued(e)) return;
      // Hors ligne : le paiement est en file d'attente ; la commande est soldée localement si le montant couvre le reste
      const cur = qc.getQueryData<Order>(["order", orderId]);
      if (!cur) return;
      const paid = cur.paidTotal + body.reduce((a, p) => a + p.amount, 0);
      const next: Order = { ...cur, paidTotal: paid, tipTotal: cur.tipTotal + body.reduce((a, p) => a + (p.tipAmount ?? 0), 0), payments: [...cur.payments, ...body.map((p) => ({ id: p.id, establishmentId: cur.establishmentId, orderId, cashSessionId: null, receivedById: null, method: p.method as Order["payments"][number]["method"], status: "COMPLETED" as const, amount: p.amount, tipAmount: p.tipAmount ?? 0, tendered: p.tendered ?? null, changeGiven: p.tendered ? Math.max(0, p.tendered - p.amount - (p.tipAmount ?? 0)) : 0, refundedAmount: 0, reference: p.reference ?? null, splitLabel: p.splitLabel ?? null, providerRef: null, createdAt: new Date(), refunds: [] }))], ...(paid >= cur.total ? { status: "PAID" as const, closedAt: new Date() } : {}) };
      setOrder(next);
      if (next.status === "PAID") { setPayOpen(false); markOfflineOrderClosed(orderId).catch(() => {}); qc.invalidateQueries({ queryKey: ["offline-orders"] }); setReceipt({ afterPayment: true }); }
    });
  };

  const products = useMemo(() => {
    if (!catalog.data) return [];
    const q = search.trim().toLowerCase();
    if (q) return catalog.data.products.filter((p) => p.name.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.barcode === q);
    return catalog.data.products.filter((p) => p.categoryId === categoryId);
  }, [catalog.data, categoryId, search]);

  /** Toucher la vignette : fiche détaillée (photo, description, options, quantité, note). */
  const onProduct = (p: PosProduct) => {
    if (!p.isAvailable || p.autoUnavailable) return toast(`${p.name} est indisponible`, "error");
    setProductOpen(p);
  };
  /** Bouton « + » de la vignette : ajout direct quand aucun choix n'est requis. */
  const quickAdd = (p: PosProduct) => {
    if (!p.isAvailable || p.autoUnavailable) return toast(`${p.name} est indisponible`, "error");
    const needsChoice = p.variants.length > 0 || p.modifierGroups.some((g) => g.minSelect > 0 && !g.modifiers.some((m) => m.isDefault));
    if (needsChoice) return setProductOpen(p);
    const defaults = p.modifierGroups.flatMap((g) => g.modifiers.filter((m) => m.isDefault).slice(0, g.maxSelect ?? undefined).map((m) => ({ modifierId: m.id })));
    addItem.mutate({ id: crypto.randomUUID(), productId: p.id, quantity: 1, modifiers: defaults });
  };

  if (order.isLoading || catalog.isLoading) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  if (!o || !catalog.data) return <div className="p-6 text-center text-muted">{online ? "Commande introuvable." : "Commande non disponible hors ligne (elle n'a jamais été ouverte sur cet appareil)."} <button className="text-lagon-600 underline" onClick={() => router.push("/pos")}>Retour</button></div>;

  const closed = o.status === "PAID" || o.status === "CANCELLED";
  const activeItems = o.items.filter((i) => i.status !== "VOIDED");
  const pendingCount = activeItems.filter((i) => i.status === "PENDING").length;
  const pendingInCourse = (cid: string | null) => activeItems.filter((i) => i.status === "PENDING" && i.courseId === cid && !i.parentItemId).length;
  const remaining = o.total - o.paidTotal;
  const showFormules = catalog.data.menus.length > 0;
  const rootItems = o.items.filter((i) => !i.parentItemId);
  const currentCourse = o.courses.find((c) => c.id === courseId);

  const itemCount = activeItems.filter((i) => !i.parentItemId).reduce((a, i) => a + i.quantity, 0);
  const categoryButton = (c: { id: string; name: string; color: string | null }, active: boolean, onClick: () => void, mobile = false) => (
    <button key={c.id} onClick={onClick} className={mobile
      ? `touch flex h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-bold transition active:scale-[0.97] ${active ? "text-white shadow-lift" : "card text-muted"}`
      : `touch flex h-16 w-full flex-col items-start justify-center gap-1 rounded-2xl px-3 text-left text-sm font-bold leading-tight transition active:scale-[0.98] ${active ? "text-white shadow-lift" : "card hover:surface-2"}`}
      style={active ? { background: `linear-gradient(140deg, ${c.color ?? "#14aaa3"}, color-mix(in srgb, ${c.color ?? "#14aaa3"} 70%, black))` } : undefined}>
      <span className={mobile ? "h-2.5 w-2.5 rounded-full" : "h-2 w-6 rounded-full"} style={{ background: active ? "rgb(255 255 255 / 0.75)" : (c.color ?? "#14aaa3") }} />
      <span className={mobile ? "whitespace-nowrap" : "line-clamp-2"}>{c.name}</span>
    </button>
  );
  const formulesCat = { id: FORMULES, name: "Formules", color: "#14aaa3" };
  const rootCategories = catalog.data.categories.filter((c) => !c.parentId);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Bandeau mobile : retour, table, recherche */}
      <div className="md:hidden flex shrink-0 items-center gap-2 px-2 pt-2">
        <button onClick={() => router.push("/pos")} className="touch flex h-11 w-11 shrink-0 items-center justify-center rounded-xl card" aria-label="Retour à la salle"><ArrowLeft className="h-5 w-5" /></button>
        <button onClick={() => !closed && setDialog("covers")} className="touch min-w-0 flex-1 text-left">
          <p className="truncate text-base font-extrabold leading-tight">{o.table ? `Table ${o.table.name}` : ORDER_TYPE_LABEL[o.type]}{o.customerName ? ` · ${o.customerName}` : ""}</p>
          <p className="truncate text-[11px] text-muted">{o.covers} couv. · {formatElapsed(o.openedAt)} · {o.number === "HORS-LIGNE" ? "hors ligne" : `n° ${o.number.split("-")[1]}`}{currentCourse && o.courses.length > 1 ? ` · ${currentCourse.name}` : ""}</p>
        </button>
        {!closed && o.type === "DINE_IN" ? <button onClick={() => setSeat(seat === null ? 1 : seat >= o.covers ? null : seat + 1)} className="touch h-9 shrink-0 rounded-full surface-2 px-3 text-xs font-bold text-muted">{seat === null ? "Table" : `C${seat}`}</button> : null}
      </div>
      <div className="md:hidden flex shrink-0 gap-2 overflow-x-auto no-scrollbar px-2 pt-2 pb-1">
        {rootCategories.map((c) => categoryButton(c, categoryId === c.id && !search, () => { setCategoryId(c.id); setSearch(""); }, true))}
        {showFormules ? categoryButton(formulesCat, categoryId === FORMULES && !search, () => { setCategoryId(FORMULES); setSearch(""); }, true) : null}
      </div>

      {/* Catégories (tablette / ordinateur) */}
      <aside className="no-print hidden w-32 shrink-0 flex-col md:flex sm:w-40">
        <button onClick={() => router.push("/pos")} className="touch mx-2 mt-2 flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-bold text-muted hover:surface-2"><ArrowLeft className="h-4 w-4" /> Salle</button>
        <div className="flex-1 space-y-1.5 overflow-y-auto no-scrollbar p-2">
          {rootCategories.map((c) => categoryButton(c, categoryId === c.id && !search, () => { setCategoryId(c.id); setSearch(""); }))}
          {showFormules ? categoryButton(formulesCat, categoryId === FORMULES && !search, () => { setCategoryId(FORMULES); setSearch(""); }) : null}
        </div>
      </aside>

      {/* Produits */}
      <section className="no-print flex min-w-0 flex-1 flex-col">
        <div className="card mx-2 mt-2 flex h-11 shrink-0 items-center gap-2 px-3 shadow-none">
          <Search className="h-4 w-4 text-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un produit, un code…" className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
          {search ? <button onClick={() => setSearch("")} className="rounded-full surface-2 px-2 py-0.5 text-xs font-semibold text-muted">Effacer</button> : null}
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto p-2 pb-24 md:pb-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {categoryId === FORMULES && !search
            ? catalog.data.menus.map((m) => (
                <button key={m.id} disabled={closed} onClick={() => setMenuOpen(m)} className="touch card relative flex h-36 flex-col overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-lift active:scale-[0.98] disabled:opacity-50">
                  {/* eslint-disable-next-line @next/next/no-img-element -- image du catalogue (URL libre) */}
                  {m.imageUrl ? <img src={m.imageUrl} alt="" loading="lazy" className="h-20 w-full shrink-0 object-cover" /> : <span className="flex h-20 w-full shrink-0 items-end bg-lagoon p-2.5"><span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Formule</span></span>}
                  <span className="flex min-h-0 flex-1 flex-col justify-between p-2.5">
                    <span className="line-clamp-2 text-[13px] font-bold leading-tight">{m.name}</span>
                    <span className="text-sm font-extrabold text-brand"><Money amount={m.priceTtc} /></span>
                  </span>
                </button>
              ))
            : products.map((p) => {
                const off = !p.isAvailable || p.autoUnavailable;
                const cat = catalog.data!.categories.find((c) => c.id === p.categoryId);
                const tint = p.color ?? cat?.color ?? "#14aaa3";
                return (
                  <div key={p.id} className={`card relative flex h-[172px] flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lift ${closed ? "opacity-50" : ""} ${off ? "opacity-60 grayscale" : ""}`}>
                    <button disabled={closed} onClick={() => onProduct(p)} className="touch flex min-h-0 flex-1 flex-col text-left active:scale-[0.99]" aria-label={`${p.name} : détail`}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- images du catalogue (URL libre), non optimisables */}
                      {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" className="h-[88px] w-full shrink-0 object-cover" /> : (
                        <span className="flex h-[88px] w-full shrink-0 items-center justify-center text-3xl font-extrabold text-white/90" style={{ background: `linear-gradient(140deg, color-mix(in srgb, ${tint} 85%, white), ${tint} 60%, color-mix(in srgb, ${tint} 75%, black))` }}>{p.name.slice(0, 1).toUpperCase()}</span>
                      )}
                      <span className="flex min-h-0 flex-1 flex-col justify-between gap-1 p-2.5 pr-11">
                        <span className="line-clamp-2 text-[13px] font-bold leading-tight">{p.name}</span>
                        <span className="flex items-center gap-1.5 text-xs font-extrabold"><Money amount={p.priceTtc} />{p.variants.length ? <span className="text-[10px] font-bold uppercase tracking-wide text-muted">dès</span> : null}{p.modifierGroups.length ? <span className="rounded-md surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">options</span> : null}</span>
                      </span>
                    </button>
                    {!closed && !off ? <button onClick={(e) => { e.stopPropagation(); quickAdd(p); }} className="touch absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white shadow-glow active:scale-90" aria-label={`Ajouter ${p.name}`}><Plus className="h-5 w-5" /></button> : null}
                    {off ? <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-red-600/90 py-0.5 text-center text-[11px] font-bold uppercase text-white">Indisponible</span> : null}
                  </div>
                );
              })}
          {products.length === 0 && categoryId !== FORMULES ? <p className="col-span-full py-10 text-center text-sm text-muted">Aucun produit</p> : null}
        </div>
      </section>

      {/* Barre mobile : résumé de la commande */}
      <div className="md:hidden fixed inset-x-0 bottom-0 z-30 flex gap-2 p-2" style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}>
        <button onClick={() => setSheet(true)} aria-label="Voir la commande" className="touch glass flex h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl border px-4 shadow-lift">
          <span className="relative"><ShoppingBasket className="h-6 w-6" />{itemCount > 0 ? <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-corail-500 px-1 text-[11px] font-extrabold text-white">{itemCount}</span> : null}</span>
          <span className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-extrabold">Commande{pendingCount > 0 ? ` · ${pendingCount} à envoyer` : ""}</span><span className="block text-[11px] text-muted">{itemCount} article{itemCount > 1 ? "s" : ""}</span></span>
          <Money amount={o.total} className="text-lg font-extrabold" />
        </button>
        {!closed && pendingCount > 0 ? <Button size="lg" variant="accent" className="h-14 shrink-0 px-4" onClick={() => send({ all: true })}><Send className="h-5 w-5" /></Button> : null}
      </div>

      {/* Ticket : colonne fixe (tablette / ordinateur) ou panneau plein écran (téléphone) */}
      <aside data-testid="ticket" className={`card flex shrink-0 flex-col overflow-hidden ${sheet ? "fixed inset-0 z-40 m-0 w-full rounded-none rise" : "hidden"} md:static md:z-auto md:m-2 md:ml-0 md:flex md:w-[340px] md:rounded-[20px] xl:w-[400px]`} style={sheet ? { paddingBottom: "env(safe-area-inset-bottom)" } : undefined}>
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center justify-between">
            <button onClick={() => setSheet(false)} className="md:hidden touch -ml-1 mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl surface-2" aria-label="Fermer la commande"><X className="h-5 w-5" /></button>
            <button onClick={() => !closed && setDialog("covers")} className="touch min-w-0 flex-1 text-left">
              <p className="truncate text-lg font-extrabold leading-tight">{o.table ? `Table ${o.table.name}` : ORDER_TYPE_LABEL[o.type]}{o.customerName ? ` · ${o.customerName}` : ""}</p>
              <p className="text-xs text-muted">{o.covers} couvert{o.covers > 1 ? "s" : ""} · {formatElapsed(o.openedAt)} · {o.server?.displayName || o.server?.firstName} · {o.number === "HORS-LIGNE" ? <span className="font-bold text-orange-500">hors ligne</span> : `n° ${o.number.split("-")[1]}`}</p>
            </button>
            {closed ? <span className={`rounded-lg px-2 py-1 text-xs font-bold ${o.status === "PAID" ? "bg-green-500/15 text-green-600" : "bg-red-500/15 text-red-600"}`}>{o.status === "PAID" ? "PAYÉE" : "ANNULÉE"}</span> : null}
          </div>
          {!closed && o.type === "DINE_IN" ? (
            <div className="mt-2 flex gap-1 overflow-x-auto no-scrollbar">
              <button onClick={() => setSeat(null)} className={`touch h-8 shrink-0 rounded-full px-3 text-xs font-bold transition ${seat === null ? "bg-nuit-800 text-white dark:bg-lagon-500 dark:text-nuit-950" : "surface-2 text-muted"}`}>Table</button>
              {Array.from({ length: o.covers }, (_, i) => i + 1).map((n) => <button key={n} onClick={() => setSeat(n)} className={`touch h-8 w-10 shrink-0 rounded-full text-xs font-bold transition ${seat === n ? "bg-nuit-800 text-white dark:bg-lagon-500 dark:text-nuit-950" : "surface-2 text-muted"}`}>C{n}</button>)}
            </div>
          ) : null}
          {!closed && o.courses.length > 1 ? (
            <div className="mt-2 flex gap-1 overflow-x-auto no-scrollbar">
              {o.courses.map((c) => (
                <button key={c.id} onClick={() => setCourseId(c.id)} className={`touch relative h-9 shrink-0 rounded-full px-3 text-[11px] font-bold transition ${courseId === c.id ? "bg-brand text-white shadow-glow" : "surface-2 text-muted"}`}>
                  {c.name}{c.status === "SENT" || c.status === "FIRE" ? " ✓" : c.status === "HOLD" ? " ⏸" : c.status === "SERVED" ? " ✔✔" : ""}
                  {pendingInCourse(c.id) > 0 ? <span className="ml-1 rounded-full bg-corail-500 px-1.5 text-[10px] text-white">{pendingInCourse(c.id)}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {rootItems.length === 0 ? <p className="p-6 text-center text-sm text-muted">Appuyez sur un produit pour l&apos;ajouter</p> : null}
          {o.courses.map((c) => {
            const items = rootItems.filter((i) => i.courseId === c.id);
            if (items.length === 0) return null;
            return (
              <div key={c.id}>
                {o.courses.length > 1 ? (
                  <div className="flex items-center justify-between surface-2 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                    <span>{c.name} {c.status === "HOLD" ? "· en attente" : c.status === "FIRE" ? "· faire marcher" : c.status === "SENT" ? "· envoyé" : c.status === "SERVED" ? "· servi" : ""}</span>
                    {!closed ? (
                      <span className="flex gap-1">
                        {c.status === "PENDING" && pendingInCourse(c.id) > 0 ? <button title="Ne pas envoyer immédiatement" onClick={() => setCourseStatus(c.id, "HOLD")} className="touch rounded p-1 hover:surface"><PauseCircle className="h-4 w-4" /></button> : null}
                        {c.status === "HOLD" ? <button title="Réactiver" onClick={() => setCourseStatus(c.id, "PENDING")} className="touch rounded p-1 text-orange-500"><PauseCircle className="h-4 w-4" /></button> : null}
                        {(c.status === "SENT" || c.status === "PENDING" || c.status === "HOLD") && items.some((i) => i.status !== "PENDING" || c.status !== "SENT") ? <button title="Faire marcher (urgent)" onClick={() => setCourseStatus(c.id, "FIRE")} className="touch rounded p-1 text-corail-500 hover:surface"><Flame className="h-4 w-4" /></button> : null}
                        {c.status === "SENT" || c.status === "FIRE" ? <button title="Marquer servi" onClick={() => setCourseStatus(c.id, "SERVED")} className="touch rounded p-1 text-green-600 hover:surface"><CheckCircle2 className="h-4 w-4" /></button> : null}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {items.map((i) => {
                  const comps = o.items.filter((x) => x.parentItemId === i.id);
                  const voided = i.status === "VOIDED";
                  return (
                    <button key={i.id} disabled={closed} onClick={() => setItemOpen(i)} className={`touch flex w-full items-start gap-2.5 border-b border-line px-4 py-2.5 text-left transition hover:surface-2 ${voided ? "opacity-40 line-through" : ""}`}>
                      <span className={`mt-0.5 flex h-7 min-w-[28px] items-center justify-center rounded-lg px-1.5 text-xs font-extrabold ${i.status === "PENDING" ? "bg-corail-500/15 text-corail-600" : "bg-lagon-500/15 text-lagon-700 dark:text-lagon-300"}`}>{i.quantity}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1 text-sm font-semibold leading-tight">{i.isUrgent ? <AlertTriangle className="h-3.5 w-3.5 text-corail-500" /> : null}{i.name}</span>
                        {i.modifiers.length ? <span className="block text-xs text-muted">{i.modifiers.map((m) => m.name).join(", ")}</span> : null}
                        {comps.map((cmp) => <span key={cmp.id} className="block text-xs text-muted">↳ {cmp.name}{cmp.modifiers.length ? ` (${cmp.modifiers.map((m) => m.name).join(", ")})` : ""}{cmp.unitPrice > 0 ? ` +${cmp.unitPrice}` : ""}</span>)}
                        {i.notes ? <span className="block text-xs italic text-corail-500">« {i.notes} »</span> : null}
                        <span className="mt-0.5 flex gap-1 text-[10px] font-semibold uppercase text-muted">{i.seatNumber ? <span className="rounded bg-slate-500/15 px-1">Client {i.seatNumber}</span> : null}<span>{i.status === "PENDING" ? "à envoyer" : i.status === "SENT" ? "envoyé" : i.status === "PREPARING" ? "en préparation" : i.status === "READY" ? "prêt" : i.status === "SERVED" ? "servi" : "annulé"}</span></span>
                      </span>
                      <span className="text-sm font-bold"><Money amount={i.lineTotal + comps.reduce((a, c) => a + c.lineTotal, 0)} /></span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="surface-2 px-4 py-3 text-sm">
          <div className="flex justify-between text-muted"><span>Sous-total</span><Money amount={o.subtotal} /></div>
          {o.discountTotal > 0 ? <div className="flex justify-between text-corail-500"><span>Remise{o.discountReason ? ` (${o.discountReason})` : ""}</span><span>−<Money amount={o.discountTotal} /></span></div> : null}
          <div className="flex justify-between text-muted"><span>dont TVA</span><Money amount={o.taxTotal} /></div>
          <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2 text-xl font-extrabold"><span>Total</span><Money amount={o.total} className="text-2xl" /></div>
          {o.paidTotal > 0 ? <div className="flex justify-between font-semibold text-lagon-600"><span>Payé</span><Money amount={o.paidTotal} /></div> : null}
          {o.paidTotal > 0 && remaining > 0 ? <div className="flex justify-between font-bold text-corail-500"><span>Reste</span><Money amount={remaining} /></div> : null}
        </div>

        {!closed ? (
          <div className="no-print space-y-2 p-3 pt-0">
            <div className="relative flex gap-2">
              <Button size="lg" variant={pendingCount > 0 ? "accent" : "secondary"} className="min-w-0 flex-1 px-2!" disabled={pendingCount === 0} onClick={() => (o.courses.length > 1 ? setSendMenu((s) => !s) : send({ all: true }))}>
                <Send className="h-5 w-5 shrink-0" /><span className="truncate">Envoyer{pendingCount > 0 ? ` (${pendingCount})` : ""}</span>{o.courses.length > 1 ? <ChevronDown className="h-4 w-4 shrink-0" /> : null}
              </Button>
              {sendMenu ? (
                <div className="absolute bottom-full left-0 z-20 mb-1 w-full overflow-hidden rounded-xl border border-line surface shadow-xl">
                  {o.courses.filter((c) => pendingInCourse(c.id) > 0).map((c) => <button key={c.id} onClick={() => send({ courseId: c.id })} className="touch flex w-full justify-between px-4 py-3 text-sm font-semibold hover:surface-2">Envoyer {c.name}<span className="text-muted">{pendingInCourse(c.id)}</span></button>)}
                  <button onClick={() => send({ all: true })} className="touch w-full border-t border-line px-4 py-3 text-sm font-bold text-lagon-600 hover:surface-2">Tout envoyer</button>
                </div>
              ) : null}
              <Button size="lg" variant="secondary" className="w-14 shrink-0 px-0!" title="Demander l'addition" disabled={activeItems.length === 0 || o.status === "BILL_REQUESTED"} onClick={requestBill}><Receipt className="h-5 w-5" /></Button>
              <Button size="lg" className="min-w-0 flex-1 px-2!" disabled={activeItems.length === 0} onClick={() => setPayOpen(true)}><CreditCard className="h-5 w-5 shrink-0" /><span className="truncate">Payer</span></Button>
            </div>
            <div className="grid grid-cols-4 gap-1">
              <button onClick={() => setDialog("discount")} className="touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl surface-2 text-[10px] font-bold uppercase text-muted hover:surface-3"><Percent className="h-4 w-4" />Remise</button>
              <button onClick={() => setDialog("transfer")} disabled={!can("pos.transfer_table")} className="touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl surface-2 text-[10px] font-bold uppercase text-muted hover:surface-3 disabled:opacity-40"><ArrowRightLeft className="h-4 w-4" />Transf.</button>
              <button onClick={() => setReceipt({ afterPayment: false })} className="touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl surface-2 text-[10px] font-bold uppercase text-muted hover:surface-3"><Printer className="h-4 w-4" />Ticket</button>
              <button onClick={() => setDialog("cancel")} className="touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl bg-red-500/10 text-[10px] font-bold uppercase text-red-600 hover:bg-red-500/15"><XCircle className="h-4 w-4" />Annuler</button>
            </div>
          </div>
        ) : (
          <div className="no-print flex gap-2 p-3">
            <Button size="lg" variant="secondary" className="flex-1" onClick={() => setReceipt({ afterPayment: false })}><Printer className="h-4 w-4" /> Reçu</Button>
            <Button size="lg" variant="secondary" className="flex-1" onClick={() => router.push("/pos")}>Retour salle</Button>
          </div>
        )}
      </aside>

      {productOpen ? <ProductModal product={productOpen} onClose={() => setProductOpen(null)} onAdd={async (c) => { addItem.mutate({ ...c, id: crypto.randomUUID() }); }} /> : null}
      {menuOpen ? <ProductModal menu={menuOpen} products={catalog.data.products} onClose={() => setMenuOpen(null)} onAdd={async (c) => { addItem.mutate({ ...c, id: crypto.randomUUID() }); }} /> : null}
      {itemOpen ? <ItemModal order={o} item={o.items.find((i) => i.id === itemOpen.id) ?? itemOpen} onClose={() => setItemOpen(null)} onUpdate={updateItem} onRemove={removeItem} /> : null}
      {payOpen ? <PaymentModal key={o.paidTotal} order={o} methods={catalog.data.paymentMethods} open onClose={() => setPayOpen(false)} onPay={pay} /> : null}
      <PinModal request={pin} onClose={() => setPin(null)} />
      {receipt ? <ReceiptDialog orderId={orderId} orderNumber={o.number} open afterPayment={receipt.afterPayment} onClose={() => { const after = receipt.afterPayment; setReceipt(null); if (after) router.push(o.tableId ? "/pos" : "/pos/orders"); }} /> : null}
      <DiscountDialog open={dialog === "discount"} order={o} onClose={() => setDialog(null)} onApply={(body) => withPin(setPin, "pos.discount", (managerPin) => api.post<Order>(`/api/orders/${orderId}/discount`, { ...body, managerPin }).then(setOrder)).then(() => setDialog(null)).catch(onError)} />
      <CancelDialog open={dialog === "cancel"} onClose={() => setDialog(null)} onConfirm={(reason) => withPin(setPin, "pos.cancel_order", (managerPin) => api.post<Order>(`/api/orders/${orderId}/cancel`, { reason, managerPin }).then(setOrder)).then(() => { setDialog(null); toast("Commande annulée"); router.push("/pos"); }).catch(onError)} />
      <TransferDialog open={dialog === "transfer"} currentTableId={o.tableId} onClose={() => setDialog(null)} onPick={(tableId) => run(() => api.post<Order>(`/api/orders/${orderId}/transfer`, { tableId })).then(() => { setDialog(null); toast("Table transférée", "success"); })} />
      {dialog === "covers" ? <CoversDialog key={`${o.covers}-${o.customerName ?? ""}`} open order={o} onClose={() => setDialog(null)} onSave={(body) => run(() => api.patch<Order>(`/api/orders/${orderId}`, body)).then(() => setDialog(null))} /> : null}
      {currentCourse?.status === "HOLD" ? <div className="pointer-events-none fixed bottom-24 right-4 rounded-lg bg-orange-500 px-3 py-1 text-xs font-bold text-white">Service « {currentCourse.name} » en attente</div> : null}
    </div>
  );
}

function DiscountDialog({ open, order, onClose, onApply }: { open: boolean; order: Order; onClose: () => void; onApply: (b: { amount?: number; percentBps?: number; reason: string }) => Promise<unknown> }) {
  const [mode, setMode] = useState<"pct" | "amt">("pct");
  const [val, setVal] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async () => { setLoading(true); try { await onApply(mode === "pct" ? { percentBps: Number(val) * 100, reason } : { amount: Number(val), reason }); setVal(""); setReason(""); } finally { setLoading(false); } };
  return (
    <Modal open={open} onClose={onClose} title="Remise" size="sm">
      <div className="mb-3 flex gap-2"><button onClick={() => { setMode("pct"); setVal(""); }} className={`touch h-10 flex-1 rounded-lg text-sm font-bold ${mode === "pct" ? "bg-lagon-600 text-white" : "surface-2"}`}>%</button><button onClick={() => { setMode("amt"); setVal(""); }} className={`touch h-10 flex-1 rounded-lg text-sm font-bold ${mode === "amt" ? "bg-lagon-600 text-white" : "surface-2"}`}>Montant</button></div>
      {mode === "pct" ? <div className="mb-3 grid grid-cols-4 gap-2">{[5, 10, 15, 20, 25, 50, 100].map((p) => <button key={p} onClick={() => setVal(String(p))} className={`touch h-11 rounded-lg text-sm font-bold ${val === String(p) ? "bg-lagon-600 text-white" : "surface-2"}`}>{p} %</button>)}</div> : null}
      <p className="mb-2 text-center text-2xl font-bold">{mode === "pct" ? `${val || 0} %` : <Money amount={Number(val || 0)} />}</p>
      <NumPad value={val} onChange={setVal} maxLength={mode === "pct" ? 3 : 8} />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif (obligatoire)" className="mt-3 h-11 w-full rounded-xl border border-line surface px-3 text-sm" />
      <div className="mt-3 flex gap-2"><Button variant="secondary" className="flex-1" onClick={() => onApply({ amount: 0, reason: "Remise retirée" })} disabled={order.discountTotal === 0}>Retirer</Button><Button className="flex-1" loading={loading} disabled={!val || !reason || (mode === "pct" && Number(val) > 100)} onClick={submit}>Appliquer</Button></div>
    </Modal>
  );
}

function CancelDialog({ open, onClose, onConfirm }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  return (
    <Modal open={open} onClose={onClose} title="Annuler la commande" size="sm">
      <p className="mb-3 text-sm text-muted">L&apos;annulation est tracée dans le journal d&apos;audit. Une commande partiellement payée doit d&apos;abord être remboursée.</p>
      <div className="mb-3 grid grid-cols-2 gap-2">{["Erreur de saisie", "Client parti", "Test / formation", "Doublon"].map((r) => <button key={r} onClick={() => setReason(r)} className={`touch h-11 rounded-lg text-sm font-semibold ${reason === r ? "bg-lagon-600 text-white" : "surface-2"}`}>{r}</button>)}</div>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif" className="h-11 w-full rounded-xl border border-line surface px-3 text-sm" />
      <Button variant="danger" className="mt-3 w-full" size="lg" loading={loading} disabled={!reason} onClick={async () => { setLoading(true); try { await onConfirm(reason); } finally { setLoading(false); } }}>Confirmer l&apos;annulation</Button>
    </Modal>
  );
}

function TransferDialog({ open, currentTableId, onClose, onPick }: { open: boolean; currentTableId: string | null; onClose: () => void; onPick: (tableId: string) => Promise<unknown> }) {
  const floor = useFloor();
  return (
    <Modal open={open} onClose={onClose} title="Transférer vers une table" size="lg">
      {(floor.data?.rooms ?? []).map((r) => (
        <div key={r.id} className="mb-3"><p className="mb-1 text-xs font-bold uppercase text-muted">{r.name}</p>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">{r.tables.map((t) => <button key={t.id} disabled={!!t.order || t.id === currentTableId} onClick={() => onPick(t.id)} className="touch h-14 rounded-xl surface-2 text-sm font-bold disabled:opacity-30">{t.name}<br /><span className="text-xs text-muted">{t.seats} pl.</span></button>)}</div>
        </div>
      ))}
    </Modal>
  );
}

function CoversDialog({ open, order, onClose, onSave }: { open: boolean; order: Order; onClose: () => void; onSave: (b: { covers: number; customerName: string | null }) => Promise<unknown> }) {
  const [covers, setCovers] = useState(order.covers);
  const [name, setName] = useState(order.customerName ?? "");
  return (
    <Modal open={open} onClose={onClose} title="Commande" size="sm">
      <p className="mb-1 text-xs font-bold uppercase text-muted">Couverts</p>
      <div className="mb-3 grid grid-cols-6 gap-2">{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <button key={n} onClick={() => setCovers(n)} className={`touch h-12 rounded-lg text-lg font-bold ${covers === n ? "bg-lagon-600 text-white" : "surface-2"}`}>{n}</button>)}</div>
      <p className="mb-1 text-xs font-bold uppercase text-muted">Nom du client (comptoir / à emporter)</p>
      <input value={name} onChange={(e) => setName(e.target.value)} className="h-11 w-full rounded-xl border border-line surface px-3 text-sm" />
      <Button className="mt-3 w-full" size="lg" onClick={() => onSave({ covers, customerName: name || null })}>Enregistrer</Button>
    </Modal>
  );
}
