"use client";

import { Photo } from "@/components/ui/photo";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Search, Send, Receipt, CreditCard, Percent, XCircle, ArrowRightLeft, Printer, Flame, PauseCircle, CheckCircle2, AlertTriangle, ChevronDown, Plus, X, ShoppingBasket, UserRound, Gift, ListOrdered } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { Money } from "@/components/money";
import { dateToZonedInput, formatElapsed, localDay, zonedInputToDate } from "@/lib/dates";
import { celebrate } from "@/lib/celebrate";
import { useSession } from "@/hooks/use-session";
import { usePosCatalog } from "./use-catalog";
import { ProductModal, type ProductChoice } from "./product-modal";
import { ItemModal } from "./item-modal";
import { PaymentModal, type PaymentPayload } from "./payment-modal";
import { PinModal, withPin, type PinRequest } from "./pin-modal";
import { ReceiptDialog } from "./receipt-dialog";
import { CustomerDialog } from "./customer-dialog";
import { ServicePanel } from "./service-panel";
import { useFloor } from "./floor";
import { useOffline } from "@/lib/offline/provider";
import { addFloorOverride, getLocalOrder, markOfflineOrderClosed, saveLocalOrder } from "@/lib/offline/local-orders";
import { mergedOrderId } from "@/lib/offline/outbox";
import { computeOrderTotals, discountLabel } from "@/lib/order-calc";
import { applyBps } from "@/lib/money";
import { addSaleLocal } from "@/lib/offline/cash-local";
import { colsFor, kitchenTickets, openDrawerLocal, printLocal, type LocalOrder, type LocalPrinter } from "@/lib/offline/print-local";
import { ORDER_TYPE_LABEL, type Order, type OrderItem, type PosMenu, type PosProduct } from "./types";
import { NumPad } from "@/components/ui/numpad";
import { WinePairingStrip } from "@/components/wine/pairing-strip";

const FORMULES = "__menus__";

/** Recalcule les totaux d'une commande modifiée localement (même logique que le serveur). */
function recomputeLocal(o: Order): Order {
  const t = computeOrderTotals(o.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unitPrice, modifiersTotal: i.modifiersTotal, discountAmount: i.discountAmount, taxRateBps: i.taxRateBps, taxRateName: i.taxRateName, voided: i.status === "VOIDED" })), o.discountTotal);
  return { ...o, subtotal: t.subtotal, discountTotal: t.discountTotal, taxTotal: t.taxTotal, total: t.total };
}

/**
 * `counter` (mode roulotte) : l'écran est la page d'accueil de la caisse, tout se passe ici. Pas d'« Envoyer » ni
 * d'addition : un seul bouton « Encaisser » ; le serveur envoie alors les articles en cuisine. `onNext` ouvre la
 * commande suivante une fois le reçu refermé.
 */
export function OrderScreen({ orderId: orderIdProp, counter = false, onNext }: { orderId: string; counter?: boolean; onNext?: () => void }) {
  // Hors ligne, la page peut être servie depuis un shell générique : l'id réel est dans l'URL
  const [orderId] = useState(() => (typeof window !== "undefined" ? window.location.pathname.split("/pos/order/")[1]?.split(/[/?#]/)[0] || orderIdProp : orderIdProp));
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can, me, hasOption } = useSession();
  const catalog = usePosCatalog();
  const { online, pending } = useOffline();
  // Table ouverte hors ligne alors qu'un autre appareil l'avait déjà ouverte : on rejoint la commande existante
  useEffect(() => {
    let live = true;
    mergedOrderId(orderId).then((to) => { if (live && to) router.replace(`/pos/order/${to}`); }).catch(() => {});
    return () => { live = false; };
  }, [orderId, pending, router]);
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
  const [panel, setPanel] = useState<"ticket" | "service">("ticket"); // Phase 9 : onglet suivi de service
  const [customerOpen, setCustomerOpen] = useState(false);

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
      const temp: OrderItem = { id: choice.id, orderId, courseId, productId: p?.id ?? null, variantId: choice.variantId ?? null, menuId: m?.id ?? null, parentItemId: null, kitchenStationId: p?.kitchenStationId ?? null, kitchenTicketId: null, name, quantity: choice.quantity, unitPrice, modifiersTotal: modsTotal, discountAmount: 0, lineTotal: (unitPrice + modsTotal) * choice.quantity, taxRateBps: p?.taxRate?.rateBps ?? 0, taxRateName: p?.taxRate?.name ?? null, taxAmount: 0, costPrice: 0, seatNumber: seat, notes: choice.notes ?? null, isUrgent: false, status: "PENDING", sentAt: null, readyAt: null, servedAt: null, voidedAt: null, voidReason: null, discountKind: null, discountBps: null, discountNote: null, discountById: null, sortOrder: current.items.length, createdAt: new Date(), updatedAt: new Date(), modifiers: modNames };
      setOrder(recomputeLocal({ ...current, items: [...current.items, temp] }));
    },
    onSuccess: (data) => setOrder(data),
    onError: (e, choice) => { onError(e); if (isQueued(e)) return; const cur = qc.getQueryData<Order>(["order", orderId]); if (cur) setOrder(recomputeLocal({ ...cur, items: cur.items.filter((i) => i.id !== choice.id) })); invalidate(); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["floor"] }),
  });

  // Renvoie true si l'opération a abouti (ou est mise en file hors ligne), false si elle a été refusée
  const run = async (fn: () => Promise<Order>, local?: (o: Order) => Order): Promise<boolean> => { try { setOrder(await fn()); return true; } catch (e) { onError(e); if (isQueued(e) && local) patchLocal(local); else if (!isQueued(e)) invalidate(); return isQueued(e); } };
  const updateItem = async (itemId: string, patch: { quantity?: number; seatNumber?: number | null; notes?: string | null; courseId?: string | null; isUrgent?: boolean }): Promise<void> => void await
    run(() => api.patch<Order>(`/api/orders/${orderId}/items/${itemId}`, patch, { queueIfOffline: true }), (o) => ({ ...o, items: o.items.map((i) => (i.id === itemId || i.parentItemId === itemId ? { ...i, ...(patch.quantity !== undefined ? { quantity: patch.quantity } : {}), ...(patch.seatNumber !== undefined ? { seatNumber: patch.seatNumber } : {}), ...(patch.courseId !== undefined ? { courseId: patch.courseId } : {}), ...(patch.isUrgent !== undefined ? { isUrgent: patch.isUrgent } : {}), ...(i.id === itemId && patch.notes !== undefined ? { notes: patch.notes } : {}) } : i)) }));
  const removeItem = async (item: OrderItem, reason: string | null) => {
    const sent = item.status !== "PENDING";
    await withPin(setPin, "pos.void_item", (managerPin) => api.delete<Order>(`/api/orders/${orderId}/items/${item.id}`, { reason, managerPin }, { queueIfOffline: !sent }).then(setOrder))
      .catch((e) => { onError(e); if (isQueued(e)) patchLocal((o) => ({ ...o, items: o.items.filter((i) => i.id !== item.id && i.parentItemId !== item.id) })); });
    setItemOpen(null);
  };
  // Option Bar : article offert (motif tracé ; droit de remise ou PIN d'un responsable)
  const offerItem = async (item: OrderItem, reason: string) => {
    await withPin(setPin, "pos.discount", (managerPin) => api.post<Order>(`/api/orders/${orderId}/items/${item.id}/offer`, { reason, managerPin }).then(setOrder)).catch(onError);
  };
  const unofferItem = async (item: OrderItem) => {
    await withPin(setPin, "pos.discount", (managerPin) => api.delete<Order>(`/api/orders/${orderId}/items/${item.id}/offer`, { managerPin }).then(setOrder)).catch(onError);
  };
  const [sending, setSending] = useState(false);
  const send = async (opts: { courseId?: string | null; all?: boolean }) => {
    setSendMenu(false);
    if (sending) return; // double appui : un seul envoi
    setSending(true);
    const now = new Date();
    const key = crypto.randomUUID(); // une clé par intention d'envoi (rejeu hors ligne sans doublon)
    let queuedSent: { order: Order; ids: string[] } | null = null;
    return run(() => api.post<Order>(`/api/orders/${orderId}/send`, opts, { idempotencyKey: key, queueIfOffline: true }),
      (o) => {
        const ids = o.items.filter((i) => i.status === "PENDING" && (opts.all || i.courseId === opts.courseId)).map((i) => i.id);
        const next: Order = { ...o, status: o.status === "OPEN" ? "SENT" : o.status, items: o.items.map((i) => (ids.includes(i.id) ? { ...i, status: "SENT", sentAt: now } : i)), courses: o.courses.map((c) => (opts.all || c.id === opts.courseId ? { ...c, status: "SENT", sentAt: now } : c)) };
        queuedSent = { order: next, ids };
        return next;
      })
      .then(async (ok) => {
        if (!ok) return;
        if (!queuedSent) return toast("Envoyé en cuisine", "success");
        // Sans internet : bons cuisine imprimés tout de suite sur l'imprimante du poste (agent d'impression du réseau local)
        const printed = await printKitchenLocal(queuedSent.order, queuedSent.ids);
        toast(printed ? "Hors ligne : bon cuisine imprimé, envoi transmis à l'écran cuisine à la reconnexion" : "Envoi enregistré, transmis en cuisine à la reconnexion", "info");
      })
      .finally(() => setSending(false));
  };
  const localPrinters = (catalog.data?.printers ?? []) as LocalPrinter[];
  /** Bons cuisine imprimés sans internet ; retourne le nombre de bons imprimés. */
  const printKitchenLocal = async (ord: Order, ids: string[]) => {
    const kitchen = localPrinters.filter((p) => p.kind === "KITCHEN" && p.driver === "agent" && p.agentUrl);
    if (!kitchen.length) return 0;
    let n = 0;
    for (const t of kitchenTickets(ord as unknown as LocalOrder, ids, catalog.data?.stations ?? [], me?.establishment?.timezone, colsFor(kitchen[0].paperWidthMm))) {
      // Imprimante du poste, sinon l'imprimante cuisine commune (même choix que le serveur)
      const target = kitchen.find((p) => p.stationId === t.stationId) ?? kitchen.find((p) => !p.stationId);
      if (!target) continue;
      try { await printLocal(target, t.ops, "Bon cuisine"); n++; }
      catch { toast(`Imprimante « ${target.name} » injoignable`, "error"); }
    }
    return n;
  };
  const setCourseStatus = (cid: string, status: "PENDING" | "HOLD" | "FIRE" | "SERVED") =>
    run(() => api.post<Order>(`/api/orders/${orderId}/courses/${cid}`, { status }, { queueIfOffline: true }), (o) => ({ ...o, courses: o.courses.map((c) => (c.id === cid ? { ...c, status } : c)) }));
  const requestBill = () => run(() => api.post<Order>(`/api/orders/${orderId}/bill`, undefined, { queueIfOffline: true }), (o) => ({ ...o, status: "BILL_REQUESTED" }))
    .then((ok) => { if (ok && online) toast("Addition demandée", "success"); });
  /** Après un encaissement réussi (saisi en caisse ou débité par le TPE). */
  const afterPayment = (paid: Order) => {
    setOrder(paid);
    if (paid.status === "PAID") { setPayOpen(false); celebrate({ count: 45 }); toast(counter ? "Encaissé ✓ · envoyé en cuisine" : "Commande soldée ✓", "success"); if (counter) qc.invalidateQueries({ queryKey: ["takeaway"] }); qc.invalidateQueries({ queryKey: ["floor"] }); qc.invalidateQueries({ queryKey: ["cash"] }); markOfflineOrderClosed(orderId).catch(() => {}); setReceipt({ afterPayment: true }); }
    else toast("Paiement enregistré", "success");
  };
  const pay = async (payments: PaymentPayload[]) => {
    const body = payments.map((p) => ({ ...p, id: crypto.randomUUID() }));
    await withPin(setPin, "pos.discount", async (managerPin) => {
      const res = await api.post<{ order: Order }>(`/api/orders/${orderId}/payments`, { payments: body, managerPin }, { idempotencyKey: crypto.randomUUID(), queueIfOffline: !body.some((p) => p.method === "COMPLIMENTARY" || p.method === "GIFT_CARD") }); // carte cadeau : solde vérifié en ligne
      afterPayment(res.order);
    }).catch((e) => {
      onError(e);
      if (!isQueued(e)) return;
      // Hors ligne : le paiement est en file d'attente ; la commande est soldée localement si le montant couvre le reste
      const cur = qc.getQueryData<Order>(["order", orderId]);
      if (!cur) return;
      const paid = cur.paidTotal + body.reduce((a, p) => a + p.amount, 0);
      const next: Order = { ...cur, paidTotal: paid, tipTotal: cur.tipTotal, payments: [...cur.payments, ...body.map((p) => ({ id: p.id, establishmentId: cur.establishmentId, orderId, cashSessionId: null, receivedById: null, method: p.method as Order["payments"][number]["method"], status: "COMPLETED" as const, amount: p.amount, tipAmount: 0, tendered: p.tendered ?? null, changeGiven: p.tendered ? Math.max(0, p.tendered - p.amount - (0)) : 0, refundedAmount: 0, reference: p.reference ?? null, splitLabel: p.splitLabel ?? null, providerRef: null, customerAccountId: p.customerAccountId ?? null, invoiceId: null, giftCardId: null, createdAt: new Date(), refunds: [] }))], ...(paid >= cur.total ? { status: "PAID" as const, closedAt: new Date() } : {}) };
      setOrder(next);
      // Caisse tenue sur la tablette (espèces théoriques) et tiroir ouvert par l'agent local pour les espèces
      addSaleLocal(body.map((p) => ({ method: p.method, amount: p.amount })), cur.number, me?.user?.displayName || me?.user?.firstName || "").then(() => qc.invalidateQueries({ queryKey: ["cash"] })).catch(() => {});
      if (body.some((p) => p.method === "CASH")) openDrawerLocal(localPrinters, me?.terminal?.id).catch(() => toast("Tiroir-caisse : agent d'impression injoignable", "error"));
      if (next.status === "PAID") {
        setPayOpen(false); markOfflineOrderClosed(orderId).catch(() => {}); qc.invalidateQueries({ queryKey: ["offline-orders"] }); setReceipt({ afterPayment: true });
        // Plan de salle hors ligne : la table se libère tout de suite (comme le fera le serveur à la synchronisation)
        addFloorOverride("closedOrders", orderId).then(() => qc.invalidateQueries({ queryKey: ["floor"] })).catch(() => {});
      }
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
  // Tout est offert (option Bar) : l'addition se clôture sans encaissement
  const topItems = activeItems.filter((i) => !i.parentItemId);
  const allOffered = hasOption("bar") && topItems.length > 0 && o.total === 0 && o.paidTotal === 0 && topItems.every((i) => i.discountKind === "OFFERED" || i.lineTotal === 0);
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
        {counter ? <button onClick={() => router.push("/pos/orders")} className="touch flex h-11 w-11 shrink-0 items-center justify-center rounded-xl card" aria-label="Commandes du jour"><ListOrdered className="h-5 w-5" /></button> : <button onClick={() => router.push("/pos")} className="touch flex h-11 w-11 shrink-0 items-center justify-center rounded-xl card" aria-label="Retour à la salle"><ArrowLeft className="h-5 w-5" /></button>}
        <button onClick={() => !closed && setDialog("covers")} className="touch min-w-0 flex-1 text-left">
          <p className="truncate text-base font-extrabold leading-tight">{o.isTab ? "Ardoise" : o.table ? `Table ${o.table.name}` : ORDER_TYPE_LABEL[o.type]}{o.customerName ? ` · ${o.customerName}` : ""}</p>
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
        {counter ? <button onClick={() => router.push("/pos/orders")} className="touch mx-2 mt-2 flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-bold text-muted hover:surface-2"><ListOrdered className="h-4 w-4" /> Commandes</button> : <button onClick={() => router.push("/pos")} className="touch mx-2 mt-2 flex h-11 items-center justify-center gap-1.5 rounded-xl text-sm font-bold text-muted hover:surface-2"><ArrowLeft className="h-4 w-4" /> Salle</button>}
        <div className="flex-1 space-y-1.5 overflow-y-auto no-scrollbar p-2">
          {rootCategories.map((c) => categoryButton(c, categoryId === c.id && !search, () => { setCategoryId(c.id); setSearch(""); }))}
          {showFormules ? categoryButton(formulesCat, categoryId === FORMULES && !search, () => { setCategoryId(FORMULES); setSearch(""); }) : null}
        </div>
      </aside>

      {/* Produits */}
      <section className="no-print flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="card mx-2 mt-2 flex h-11 shrink-0 items-center gap-2 px-3 shadow-none">
          <Search className="h-4 w-4 text-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher un produit, un code…" className="h-9 flex-1 bg-transparent text-sm outline-none placeholder:text-muted" />
          {search ? <button onClick={() => setSearch("")} className="rounded-full surface-2 px-2 py-0.5 text-xs font-semibold text-muted">Effacer</button> : null}
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto p-2 pb-24 md:pb-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {categoryId === FORMULES && !search
            ? catalog.data.menus.map((m) => (
                <button key={m.id} disabled={closed} onClick={() => setMenuOpen(m)} className="touch card relative flex h-[190px] flex-col overflow-hidden text-left transition hover:-translate-y-0.5 hover:shadow-lift active:scale-[0.98] disabled:opacity-50">
                  { }
                  <Photo src={m.imageUrl} className="h-[118px] w-full shrink-0 object-cover" fallback={<span className="flex h-[118px] w-full shrink-0 items-end bg-lagoon p-2.5"><span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Formule</span></span>} />
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
                  <div key={p.id} className={`card relative flex h-[190px] flex-col overflow-hidden transition hover:-translate-y-0.5 hover:shadow-lift ${closed ? "opacity-50" : ""} ${off ? "opacity-60 grayscale" : ""}`}>
                    <button disabled={closed} onClick={() => onProduct(p)} className="touch flex min-h-0 flex-1 flex-col text-left active:scale-[0.99]" aria-label={`${p.name} : détail`}>
                      <Photo src={p.imageUrl} className="h-[118px] w-full shrink-0 object-cover" fallback={
                        <span className="flex h-[118px] w-full shrink-0 items-center justify-center text-4xl font-extrabold text-white/90" style={{ background: `linear-gradient(140deg, color-mix(in srgb, ${tint} 85%, white), ${tint} 60%, color-mix(in srgb, ${tint} 75%, black))` }}>{p.name.slice(0, 1).toUpperCase()}</span>
                      } />
                      <span className="flex min-h-0 flex-1 flex-col justify-between gap-0.5 px-2.5 py-2 pr-11">
                        <span className="line-clamp-2 text-[13px] font-bold leading-tight">{p.name}</span>
                        <span className="flex items-center gap-1.5 text-sm font-extrabold text-brand"><Money amount={p.priceTtc} />{p.variants.length ? <span className="text-[10px] font-bold uppercase tracking-wide text-muted">dès</span> : null}{p.modifierGroups.length ? <span className="rounded-md surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">options</span> : null}</span>
                      </span>
                    </button>
                    {!closed && !off ? <button onClick={(e) => { e.stopPropagation(); quickAdd(p); }} className="touch absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white shadow-glow active:scale-90" aria-label={`Ajouter ${p.name}`}><Plus className="h-5 w-5" /></button> : null}
                    {off ? <span className="absolute inset-x-0 top-1/2 -translate-y-1/2 bg-red-600/90 py-0.5 text-center text-[11px] font-bold uppercase text-white">Indisponible</span> : null}
                  </div>
                );
              })}
          {products.length === 0 && categoryId !== FORMULES ? (
            <div className="col-span-full flex flex-col items-center gap-2 py-10 text-center">
              <span className="text-4xl" aria-hidden>{search.trim() ? "🔎" : "🍽️"}</span>
              <p className="text-sm font-bold">{search.trim() ? `Aucun produit pour « ${search.trim()} »` : "Aucun produit ici pour l'instant"}</p>
              {!search.trim() && can("catalog.manage") ? <Button size="sm" variant="secondary" onClick={() => router.push("/admin/catalog/products")}>Ajouter des produits à la carte</Button> : null}
            </div>
          ) : null}
        </div>
      </section>

      {/* Barre mobile : résumé de la commande */}
      {/* Posée en bas de la zone de contenu, juste au-dessus de la barre des portails */}
      <div className="md:hidden absolute inset-x-0 bottom-0 z-30 flex gap-2 p-2">
        <button onClick={() => setSheet(true)} aria-label="Voir la commande" className="touch glass flex h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl border px-4 shadow-lift">
          <span className="relative"><ShoppingBasket className="h-6 w-6" />{itemCount > 0 ? <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-corail-500 px-1 text-[11px] font-extrabold text-white">{itemCount}</span> : null}</span>
          <span className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-extrabold">Commande{!counter && pendingCount > 0 ? ` · ${pendingCount} à envoyer` : ""}</span><span className="block text-[11px] text-muted">{itemCount} article{itemCount > 1 ? "s" : ""}</span></span>
          <Money amount={o.total} className="text-lg font-extrabold" />
        </button>
        {!closed && counter && activeItems.length > 0 ? <Button size="lg" className="h-14 shrink-0 px-4" aria-label="Encaisser" onClick={() => setPayOpen(true)}><CreditCard className="h-5 w-5" /></Button> : null}
        {!closed && !counter && pendingCount > 0 ? <Button size="lg" variant="accent" className="h-14 shrink-0 px-4" disabled={sending} aria-label="Envoyer en cuisine" onClick={() => send({ all: true })}><Send className="h-5 w-5" /></Button> : null}
      </div>

      {/* Ticket : colonne fixe (tablette / ordinateur) ou panneau plein écran (téléphone) */}
      <aside data-testid="ticket" className={`card flex shrink-0 flex-col overflow-hidden ${sheet ? "fixed inset-0 z-40 m-0 w-full rounded-none rise" : "hidden"} md:static md:z-auto md:m-2 md:ml-0 md:flex md:w-[340px] md:rounded-[20px] xl:w-[400px]`} style={sheet ? { paddingBottom: "env(safe-area-inset-bottom)" } : undefined}>
        <div className="border-b border-line px-4 py-3">
          <div className="flex items-center justify-between">
            <button onClick={() => setSheet(false)} className="md:hidden touch -ml-1 mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl surface-2" aria-label="Fermer la commande"><X className="h-5 w-5" /></button>
            <button onClick={() => !closed && setDialog("covers")} className="touch min-w-0 flex-1 text-left">
              <p className="truncate text-lg font-extrabold leading-tight">{o.isTab ? "Ardoise" : o.table ? `Table ${o.table.name}` : ORDER_TYPE_LABEL[o.type]}{o.customerName ? ` · ${o.customerName}` : ""}</p>
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
          {o.type === "DINE_IN" && o.table ? (
            <div className="mt-2 flex rounded-xl surface-2 p-0.5 text-xs font-bold" role="tablist">
              <button role="tab" aria-selected={panel === "ticket"} onClick={() => setPanel("ticket")} className={`touch h-8 flex-1 rounded-[10px] ${panel === "ticket" ? "surface shadow-soft" : "text-muted"}`}>Commande</button>
              <button role="tab" aria-selected={panel === "service"} onClick={() => setPanel("service")} className={`touch h-8 flex-1 rounded-[10px] ${panel === "service" ? "surface shadow-soft" : "text-muted"}`}>Service</button>
            </div>
          ) : null}
          {!closed && o.courses.length > 1 && panel === "ticket" ? (
            <div className="mt-2 flex gap-1 overflow-x-auto no-scrollbar">
              {o.courses.map((c) => (
                <button key={c.id} onClick={() => setCourseId(c.id)} className={`touch relative h-9 shrink-0 rounded-full px-3 text-[11px] font-bold transition ${courseId === c.id ? "bg-brand text-white shadow-glow" : "surface-2 text-muted"}`}>
                  {c.name}{c.status === "SENT" || c.status === "FIRE" ? " ✓" : c.status === "HOLD" ? " ⏸" : c.status === "READY" ? " 🔔" : c.status === "SERVED" ? " ✔✔" : ""}
                  {pendingInCourse(c.id) > 0 ? <span className="ml-1 rounded-full bg-corail-500 px-1.5 text-[10px] text-white">{pendingInCourse(c.id)}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {panel === "service" && o.number !== "HORS-LIGNE" ? <ServicePanel orderId={orderId} closed={closed} /> : null}
          {panel === "service" && o.number === "HORS-LIGNE" ? <p className="p-4 text-sm text-muted">Le suivi de service sera disponible dès la synchronisation de la commande.</p> : null}
          {panel === "ticket" && rootItems.length === 0 ? <p className="p-6 text-center text-sm text-muted">Appuyez sur un produit pour l&apos;ajouter</p> : null}
          {o.courses.map((c) => {
            const items = rootItems.filter((i) => i.courseId === c.id);
            if (items.length === 0 || panel === "service") return null;
            const hasReady = items.some((i) => i.status === "READY");
            return (
              <div key={c.id}>
                {o.courses.length > 1 ? (
                  <div className="flex items-center justify-between surface-2 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-muted">
                    <span>{c.name} {c.status === "HOLD" ? "· en attente" : c.status === "FIRE" ? "· faire marcher" : c.status === "SENT" ? "· envoyé" : c.status === "READY" ? "· prêt en cuisine" : c.status === "SERVED" ? "· servi" : ""}</span>
                    {!closed ? (
                      <span className="flex gap-1">
                        {c.status === "PENDING" && pendingInCourse(c.id) > 0 ? <button title="Ne pas envoyer immédiatement" onClick={() => setCourseStatus(c.id, "HOLD")} className="touch rounded p-1 hover:surface"><PauseCircle className="h-4 w-4" /></button> : null}
                        {c.status === "HOLD" ? <button title="Réactiver" onClick={() => setCourseStatus(c.id, "PENDING")} className="touch rounded p-1 text-orange-500"><PauseCircle className="h-4 w-4" /></button> : null}
                        {(c.status === "SENT" || c.status === "PENDING" || c.status === "HOLD") && items.some((i) => i.status !== "PENDING" || c.status !== "SENT") ? <button title="Faire marcher (urgent)" onClick={() => setCourseStatus(c.id, "FIRE")} className="touch rounded p-1 text-corail-500 hover:surface"><Flame className="h-4 w-4" /></button> : null}
                        {c.status === "SENT" || c.status === "FIRE" || c.status === "READY" || hasReady ? <button title="Apporté à la table" onClick={() => setCourseStatus(c.id, "SERVED")} className={`touch flex items-center gap-1 rounded p-1 text-green-600 hover:surface ${hasReady ? "bg-green-500/15 px-2 font-bold normal-case tracking-normal" : ""}`}><CheckCircle2 className="h-4 w-4" />{hasReady ? "Apporté" : null}</button> : null}
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
                        {discountLabel(i) ? <span className={`mt-0.5 inline-block rounded-md px-1.5 text-[11px] font-bold ${i.discountKind === "OFFERED" ? "bg-fuchsia-500/12 text-fuchsia-700 dark:text-fuchsia-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`} data-testid="line-discount">{discountLabel(i)}</span> : null}
                        <span className="mt-0.5 flex gap-1 text-[10px] font-semibold uppercase text-muted">{i.seatNumber ? <span className="rounded bg-slate-500/15 px-1">Client {i.seatNumber}</span> : null}<span>{i.status === "PENDING" ? (counter ? "à encaisser" : "à envoyer") : i.status === "SENT" ? "envoyé" : i.status === "PREPARING" ? "en préparation" : i.status === "READY" ? "prêt" : i.status === "SERVED" ? "servi" : "annulé"}</span></span>
                      </span>
                      <span className="text-sm font-bold"><Money amount={i.lineTotal + comps.reduce((a, c) => a + c.lineTotal, 0)} /></span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {!closed && panel === "ticket" && rootItems.length ? <WinePairingStrip productIds={rootItems.filter((i) => i.status !== "VOIDED" && i.productId).map((i) => i.productId!)} onAdd={(productId) => addItem.mutate({ id: crypto.randomUUID(), productId, quantity: 1 })} /> : null}
        </div>

        <div className="surface-2 px-4 py-3 text-sm">
          <div className="flex justify-between text-muted"><span>Sous-total</span><Money amount={o.subtotal} /></div>
          {o.discountTotal > 0 ? <div className="flex justify-between text-corail-500"><span>Remise{o.discountReason ? ` (${o.discountReason})` : ""}</span><span>−<Money amount={o.discountTotal} /></span></div> : null}
          <div className="flex justify-between text-muted"><span>dont TVA</span><Money amount={o.taxTotal} /></div>
          <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2 text-xl font-extrabold"><span>Total</span><Money amount={o.total} className="text-2xl" /></div>
          {o.paidTotal > 0 ? <div className="flex justify-between font-semibold text-lagon-600"><span>Payé</span><Money amount={o.paidTotal} /></div> : null}
          {o.paidTotal > 0 && remaining > 0 ? <div className="flex justify-between font-bold text-corail-500"><span>Reste</span><Money amount={remaining} /></div> : null}
        </div>

        {!closed && counter ? (
          <div className="no-print space-y-2 p-3 pt-0">
            {allOffered ? (
              <Button size="xl" className="w-full" onClick={() => run(() => api.post<Order>(`/api/orders/${orderId}/close-offered`))} data-testid="close-offered"><Gift className="h-5 w-5 shrink-0" /><span className="truncate">Clôturer (offert) et envoyer en cuisine</span></Button>
            ) : (
              <Button size="xl" className="w-full" disabled={activeItems.length === 0} onClick={() => setPayOpen(true)} data-testid="counter-pay"><CreditCard className="h-6 w-6 shrink-0" /><span className="flex min-w-0 flex-1 items-center justify-between gap-2"><span className="truncate">Encaisser et envoyer en cuisine</span><Money amount={remaining} className="shrink-0" /></span></Button>
            )}
            <div className="grid grid-cols-4 gap-1">
              <button onClick={() => setCustomerOpen(true)} className={`touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-bold uppercase hover:surface-3 ${o.customerId ? "bg-lagon-500/15 text-lagon-700 dark:text-lagon-300" : "surface-2 text-muted"}`}><UserRound className="h-4 w-4" />Client</button>
              <button onClick={() => setDialog("discount")} className="touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl surface-2 text-[10px] font-bold uppercase text-muted hover:surface-3"><Percent className="h-4 w-4" />Remise</button>
              <button onClick={() => setReceipt({ afterPayment: false })} className="touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl surface-2 text-[10px] font-bold uppercase text-muted hover:surface-3"><Printer className="h-4 w-4" />Ticket</button>
              <button onClick={() => setDialog("cancel")} disabled={activeItems.length === 0} className="touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl bg-red-500/10 text-[10px] font-bold uppercase text-red-600 hover:bg-red-500/15 disabled:opacity-40"><XCircle className="h-4 w-4" />Vider</button>
            </div>
          </div>
        ) : !closed ? (
          <div className="no-print space-y-2 p-3 pt-0">
            <div className="relative flex gap-2">
              <Button size="lg" variant={pendingCount > 0 ? "accent" : "secondary"} className="min-w-0 flex-1 px-2!" disabled={pendingCount === 0 || sending} onClick={() => (o.courses.length > 1 ? setSendMenu((s) => !s) : send({ all: true }))}>
                <Send className="h-5 w-5 shrink-0" /><span className="truncate">Envoyer{pendingCount > 0 ? ` (${pendingCount})` : ""}</span>{o.courses.length > 1 ? <ChevronDown className="h-4 w-4 shrink-0" /> : null}
              </Button>
              {sendMenu ? (
                <div className="absolute bottom-full left-0 z-20 mb-1 w-full overflow-hidden rounded-xl border border-line surface shadow-xl">
                  {o.courses.filter((c) => pendingInCourse(c.id) > 0).map((c) => <button key={c.id} onClick={() => send({ courseId: c.id })} className="touch flex w-full justify-between px-4 py-3 text-sm font-semibold hover:surface-2">Envoyer {c.name}<span className="text-muted">{pendingInCourse(c.id)}</span></button>)}
                  <button onClick={() => send({ all: true })} className="touch w-full border-t border-line px-4 py-3 text-sm font-bold text-lagon-600 hover:surface-2">Tout envoyer</button>
                </div>
              ) : null}
              <Button size="lg" variant="secondary" className="w-14 shrink-0 px-0!" title="Demander l'addition" disabled={activeItems.length === 0 || o.status === "BILL_REQUESTED"} onClick={requestBill}><Receipt className="h-5 w-5" /></Button>
              {allOffered ? (
                <Button size="lg" className="min-w-0 flex-1 px-2!" onClick={() => run(() => api.post<Order>(`/api/orders/${orderId}/close-offered`))} data-testid="close-offered"><Gift className="h-5 w-5 shrink-0" /><span className="truncate">Clôturer (offert)</span></Button>
              ) : <Button size="lg" className="min-w-0 flex-1 px-2!" disabled={activeItems.length === 0} onClick={() => setPayOpen(true)}><CreditCard className="h-5 w-5 shrink-0" /><span className="truncate">Payer</span></Button>}
            </div>
            <div className="grid grid-cols-5 gap-1">
              <button onClick={() => setCustomerOpen(true)} className={`touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl text-[10px] font-bold uppercase hover:surface-3 ${o.customerId ? "bg-lagon-500/15 text-lagon-700 dark:text-lagon-300" : "surface-2 text-muted"}`}><UserRound className="h-4 w-4" />Client</button>
              <button onClick={() => setDialog("discount")} className="touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl surface-2 text-[10px] font-bold uppercase text-muted hover:surface-3"><Percent className="h-4 w-4" />Remise</button>
              <button onClick={() => setDialog("transfer")} disabled={!can("pos.transfer_table")} className="touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl surface-2 text-[10px] font-bold uppercase text-muted hover:surface-3 disabled:opacity-40"><ArrowRightLeft className="h-4 w-4" />Transf.</button>
              <button onClick={() => setReceipt({ afterPayment: false })} className="touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl surface-2 text-[10px] font-bold uppercase text-muted hover:surface-3"><Printer className="h-4 w-4" />Ticket</button>
              <button onClick={() => setDialog("cancel")} className="touch flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl bg-red-500/10 text-[10px] font-bold uppercase text-red-600 hover:bg-red-500/15"><XCircle className="h-4 w-4" />Annuler</button>
            </div>
          </div>
        ) : (
          <div className="no-print flex gap-2 p-3">
            <Button size="lg" variant="secondary" className="flex-1" onClick={() => setReceipt({ afterPayment: false })}><Printer className="h-4 w-4" /> Reçu</Button>
            {counter && onNext ? <Button size="lg" className="flex-1" onClick={onNext} data-testid="counter-next"><Plus className="h-4 w-4" /> Commande suivante</Button> : <Button size="lg" variant="secondary" className="flex-1" onClick={() => router.push(o.isTab ? "/pos/bar" : "/pos")}>{o.isTab ? "Retour au bar" : "Retour salle"}</Button>}
          </div>
        )}
      </aside>

      {productOpen ? <ProductModal product={productOpen} onClose={() => setProductOpen(null)} onAdd={async (c) => { addItem.mutate({ ...c, id: crypto.randomUUID() }); }} /> : null}
      {menuOpen ? <ProductModal menu={menuOpen} products={catalog.data.products} onClose={() => setMenuOpen(null)} onAdd={async (c) => { addItem.mutate({ ...c, id: crypto.randomUUID() }); }} /> : null}
      {itemOpen ? <ItemModal order={o} item={o.items.find((i) => i.id === itemOpen.id) ?? itemOpen} onClose={() => setItemOpen(null)} onUpdate={updateItem} onRemove={removeItem} {...(hasOption("bar") ? { onOffer: offerItem, onUnoffer: unofferItem } : {})} /> : null}
      {payOpen ? <PaymentModal key={o.paidTotal} order={o} methods={catalog.data.paymentMethods} open onClose={() => setPayOpen(false)} onPay={pay} onPaid={afterPayment} /> : null}
      <CustomerDialog open={customerOpen} orderId={orderId} customerId={o.customerId} closed={closed} onClose={() => setCustomerOpen(false)} onChanged={() => { qc.invalidateQueries({ queryKey: ["order", orderId] }); qc.invalidateQueries({ queryKey: ["customer"] }); }} />
      {receipt ? <ReceiptDialog order={o} printers={localPrinters} orderId={orderId} orderNumber={o.number} open afterPayment={receipt.afterPayment} onClose={() => { const after = receipt.afterPayment; setReceipt(null); if (!after) return; if (counter && onNext) onNext(); else router.push(o.tableId ? "/pos" : "/pos/orders"); }} /> : null}
      <DiscountDialog open={dialog === "discount"} order={o} onClose={() => setDialog(null)} onApply={(body) => withPin(setPin, "pos.discount", (managerPin) => api.post<Order>(`/api/orders/${orderId}/discount`, { ...body, managerPin }).then(setOrder)).then(() => setDialog(null)).catch((e) => {
        onError(e);
        if (!isQueued(e)) return;
        // Hors ligne : remise appliquée sur la tablette (même calcul que le serveur)
        patchLocal((x) => { const amount = body.percentBps !== undefined ? applyBps(x.subtotal, body.percentBps) : (body.amount ?? 0); return { ...x, discountTotal: amount, discountReason: amount > 0 ? body.reason : null }; });
        setDialog(null);
      })} />
      <CancelDialog open={dialog === "cancel"} onClose={() => setDialog(null)} onConfirm={(reason) => withPin(setPin, "pos.cancel_order", (managerPin) => api.post<Order>(`/api/orders/${orderId}/cancel`, { reason, managerPin }).then(setOrder)).then(() => { setDialog(null); toast("Commande annulée"); if (counter && onNext) onNext(); else router.push("/pos"); }).catch((e) => {
        onError(e);
        if (!isQueued(e)) return;
        // Hors ligne : commande annulée sur la tablette, table libérée sur le plan
        patchLocal((x) => ({ ...x, status: "CANCELLED", cancelReason: reason, closedAt: new Date() }));
        markOfflineOrderClosed(orderId).catch(() => {});
        addFloorOverride("closedOrders", orderId).then(() => qc.invalidateQueries({ queryKey: ["floor"] })).catch(() => {});
        setDialog(null);
        router.push("/pos");
      })} />
      <TransferDialog open={dialog === "transfer"} currentTableId={o.tableId} onClose={() => setDialog(null)} onPick={(tableId) => run(() => api.post<Order>(`/api/orders/${orderId}/transfer`, { tableId })).then((ok) => { if (ok) { setDialog(null); toast("Table transférée", "success"); } })} />
      {dialog === "covers" ? <CoversDialog key={`${o.covers}-${o.customerName ?? ""}`} open order={o} onClose={() => setDialog(null)} onSave={(body) => run(() => api.patch<Order>(`/api/orders/${orderId}`, body, { queueIfOffline: true }), (o) => ({ ...o, ...body, pickupAt: body.pickupAt === undefined ? o.pickupAt : body.pickupAt ? new Date(body.pickupAt) : null })).then(() => setDialog(null))} /> : null}
      {/* En dernier : la demande de PIN manager s'affiche au-dessus de la fenêtre qui l'a déclenchée (remise, annulation…) */}
      <PinModal request={pin} onClose={() => setPin(null)} />
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

function CoversDialog({ open, order, onClose, onSave }: { open: boolean; order: Order; onClose: () => void; onSave: (b: { covers: number; customerName: string | null; customerPhone?: string | null; pickupAt?: string | null }) => Promise<unknown> }) {
  const { timezone } = useSession();
  const takeaway = order.type !== "DINE_IN";
  const [covers, setCovers] = useState(order.covers);
  const [name, setName] = useState(order.customerName ?? "");
  const [phone, setPhone] = useState(order.customerPhone ?? "");
  // Heure de retrait (à emporter) : saisie à l'heure du restaurant, aujourd'hui
  const [pickup, setPickup] = useState(order.pickupAt ? dateToZonedInput(order.pickupAt, timezone).slice(11, 16) : "");
  const save = () => onSave({
    covers, customerName: name || null,
    ...(takeaway ? { customerPhone: phone.trim() || null, pickupAt: pickup ? zonedInputToDate(`${localDay(new Date(), timezone)}T${pickup}`, timezone).toISOString() : null } : {}),
  });
  return (
    <Modal open={open} onClose={onClose} title={takeaway ? "Client et retrait" : "Commande"} size="sm">
      {!takeaway ? <>
        <p className="mb-1 text-xs font-bold uppercase text-muted">Couverts</p>
        <div className="mb-3 grid grid-cols-6 gap-2">{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <button key={n} onClick={() => setCovers(n)} className={`touch h-12 rounded-lg text-lg font-bold ${covers === n ? "bg-lagon-600 text-white" : "surface-2"}`}>{n}</button>)}</div>
      </> : null}
      <p className="mb-1 text-xs font-bold uppercase text-muted">Nom du client</p>
      <input value={name} onChange={(e) => setName(e.target.value)} className="h-11 w-full rounded-xl border border-line surface px-3 text-sm" />
      {takeaway ? <>
        <p className="mb-1 mt-3 text-xs font-bold uppercase text-muted">Téléphone</p>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className="h-11 w-full rounded-xl border border-line surface px-3 text-sm" />
        <p className="mb-1 mt-3 text-xs font-bold uppercase text-muted">Heure de retrait</p>
        <div className="flex gap-2"><input type="time" value={pickup} onChange={(e) => setPickup(e.target.value)} aria-label="Heure de retrait" className="h-11 flex-1 rounded-xl border border-line surface px-3 text-sm" />{pickup ? <button onClick={() => setPickup("")} className="rounded-xl px-3 text-xs font-semibold text-muted hover:surface-2">Dès que possible</button> : null}</div>
      </> : null}
      <Button className="mt-3 w-full" size="lg" onClick={save}>Enregistrer</Button>
    </Modal>
  );
}
