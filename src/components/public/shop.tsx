"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, ApiClientError } from "@/lib/api-client";
import { Spinner } from "@/components/ui/misc";
import { Field, Input, Select } from "@/components/ui/field";
import { Logo } from "@/components/brand";
import { Money } from "@/components/money";
import { useToast } from "@/components/ui/toast";
import { usePublicLang, LangSwitch } from "@/lib/i18n/public";
import { MenuBrowser, Cart, toLines, type CartLine, type PublicCatalog } from "./menu-browser";
import type { DigitalSettings } from "@/server/services/public";

type Data = { establishment: { id: string; name: string; phone: string | null; addressLine1: string | null; city: string | null }; online: DigitalSettings["online"]; catalog: PublicCatalog };

/** Commande en ligne : click & collect ou livraison, coordonnées, suivi. */
export function ShopScreen({ org, est }: { org: string; est: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const { lang, setLang, t } = usePublicLang();
  const q = useQuery({ queryKey: ["public-shop", org, est], queryFn: () => api.get<Data>(`/api/public/shop/${org}/${est}`) });
  const [cart, setCart] = useState<CartLine[]>([]);
  const [mode, setMode] = useState<"PICKUP" | "DELIVERY">("PICKUP");
  const [f, setF] = useState({ name: "", phone: "", email: "", when: "", address: "", zone: "", notes: "" });
  const [sending, setSending] = useState(false);
  // Téléphone : le panier est sous la carte ; une barre fixe y mène tant qu'il n'est pas à l'écran
  const checkout = useRef<HTMLDivElement>(null);
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  useEffect(() => {
    const el = checkout.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setCheckoutVisible(e.isIntersecting), { rootMargin: "0px 0px -35% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [q.data]);
  const d = q.data;
  if (q.isLoading) return <div className="flex h-dvh items-center justify-center"><Spinner /></div>;
  if (!d) return <main className="p-8 text-center text-muted">Établissement introuvable.</main>;
  const o = d.online;
  const subtotal = cart.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  const fee = mode === "DELIVERY" ? o.deliveryFee : 0;
  const valid = cart.length > 0 && f.name.trim().length >= 2 && f.phone.trim().length >= 6 && (mode === "PICKUP" || (f.address.trim().length > 3 && (o.deliveryZones.length === 0 || !!f.zone))) && (mode === "PICKUP" || subtotal >= o.deliveryMinOrder);
  const submit = async () => {
    setSending(true);
    try {
      const r = await api.post<{ publicToken: string }>(`/api/public/shop/${org}/${est}/order`, { id: crypto.randomUUID(), mode, name: f.name, phone: f.phone, email: f.email || null, when: f.when || null, address: mode === "DELIVERY" ? f.address : null, zone: mode === "DELIVERY" ? f.zone || null : null, notes: f.notes || null, lines: toLines(cart), lang });
      router.push(`/suivi/${r.publicToken}`);
    } catch (e) { toast(e instanceof ApiClientError ? e.message : "Erreur", "error"); setSending(false); }
  };
  return (
    <div className={`mx-auto max-w-6xl px-3 pt-3 sm:px-4 ${cart.length ? "pb-28 lg:pb-10" : "pb-10"}`}>
      <header className="mb-3 flex items-center gap-3">
        <Logo size={36} withText={false} />
        <div className="min-w-0 flex-1"><p className="truncate text-lg font-extrabold">{d.establishment.name}</p><p className="truncate text-xs text-muted">{[d.establishment.addressLine1, d.establishment.city, d.establishment.phone].filter(Boolean).join(" · ")}</p></div>
        <LangSwitch lang={lang} setLang={setLang} />
      </header>
      {!o.enabled ? <div className="card p-8 text-center"><p className="text-lg font-bold">{t("closed")}</p>{o.message ? <p className="mt-2 text-sm text-muted">{o.message}</p> : null}</div> : (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <MenuBrowser catalog={d.catalog} cart={cart} setCart={setCart} t={t} />
          <div ref={checkout} className="scroll-mt-3 space-y-3 lg:sticky lg:top-3 lg:self-start">
            {o.message ? <p className="rounded-xl bg-lagon-500/10 px-3 py-2 text-sm text-lagon-800 dark:text-lagon-200">{o.message}</p> : null}
            <div className="card p-4">
              <div className="mb-3 flex gap-2">{o.pickup ? <button onClick={() => setMode("PICKUP")} className={`touch h-11 flex-1 rounded-xl text-sm font-bold ${mode === "PICKUP" ? "bg-brand text-white" : "surface-2"}`}>{t("pickup")}</button> : null}{o.delivery ? <button onClick={() => setMode("DELIVERY")} className={`touch h-11 flex-1 rounded-xl text-sm font-bold ${mode === "DELIVERY" ? "bg-brand text-white" : "surface-2"}`}>{t("delivery")}</button> : null}</div>
              <p className="mb-3 text-xs text-muted">{mode === "PICKUP" ? `${t("leadTime")} ${o.pickupLeadMin} ${t("minutes")} · ${t("payAtPickup")}` : `${t("deliveryFee")} ${o.deliveryFee} F · ${t("minOrder")} ${o.deliveryMinOrder} F · ${t("payAtDelivery")}`}</p>
              <p className="mb-2 text-xs font-bold uppercase text-muted">{t("contact")}</p>
              <div className="space-y-2">
                <Field label={t("name")}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></Field>
                <Field label={t("phone")}><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></Field>
                <Field label={t("email")}><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></Field>
                <Field label={t("when")}><Input value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} placeholder={t("asap")} /></Field>
                {mode === "DELIVERY" ? <><Field label={t("address")}><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} autoComplete="street-address" /></Field>{o.deliveryZones.length ? <Field label={t("zone")}><Select value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })}><option value="">—</option>{o.deliveryZones.map((z) => <option key={z} value={z}>{z}</option>)}</Select></Field> : null}</> : null}
              </div>
            </div>
            <Cart cart={cart} setCart={setCart} t={t} note={f.notes} setNote={(v) => setF({ ...f, notes: v })} extra={fee ? [{ label: t("deliveryFee"), amount: fee }] : []} action={submit} actionLabel={sending ? "…" : t("confirm")} disabled={!valid || sending} />
          </div>
        </div>
      )}
      {o.enabled && cart.length && !checkoutVisible ? (
        <div className="fixed inset-x-0 bottom-0 z-20 p-3 lg:hidden" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <button onClick={() => checkout.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="touch flex h-14 w-full items-center justify-between rounded-2xl bg-brand px-5 text-white shadow-glow" data-testid="shop-cart-bar">
            <span className="font-bold">{t("cart")} · {cart.reduce((a, l) => a + l.quantity, 0)}</span>
            <Money amount={subtotal + fee} className="text-lg font-extrabold" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
