"use client";
/* eslint-disable @next/next/no-img-element -- photos du catalogue (URL libre) et QR codes générés : non optimisables par next/image */

import { useMemo, useState } from "react";
import { Search, Plus, Minus, ShoppingBasket, Trash2 } from "lucide-react";
import { ProductModal, type ProductChoice } from "@/components/pos/product-modal";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import type { PosProduct, PosMenu } from "@/components/pos/types";
import type { publicCatalog } from "@/server/services/public";
import type { Key } from "@/lib/i18n/public";

export type PublicCatalog = Awaited<ReturnType<typeof publicCatalog>>;
export type CartLine = ProductChoice & { id: string; name: string; unitPrice: number; detail: string };

/** Prix d'une ligne à partir du catalogue (variantes, options, formules). */
export function priceOf(catalog: PublicCatalog, c: ProductChoice): { name: string; unitPrice: number; detail: string } {
  if (c.menuId) {
    const m = catalog.menus.find((x) => x.id === c.menuId)!;
    const names: string[] = [];
    let extra = 0;
    for (const sel of c.menuSelections ?? []) { const sec = m.sections.find((s) => s.id === sel.sectionId); const it = sec?.items.find((i) => i.productId === sel.productId); if (it) { names.push(it.product.name); extra += it.supplement; } const p = catalog.products.find((x) => x.id === sel.productId); for (const mod of sel.modifiers ?? []) { const mm = p?.modifierGroups.flatMap((g) => g.modifiers).find((x) => x.id === mod.modifierId); if (mm) { extra += mm.priceDelta; names.push(mm.name); } } }
    return { name: m.name, unitPrice: m.priceTtc + extra, detail: names.join(", ") };
  }
  const p = catalog.products.find((x) => x.id === c.productId)!;
  const base = c.variantId ? (p.variants.find((v) => v.id === c.variantId)?.priceTtc ?? p.priceTtc) : p.priceTtc;
  const mods = p.modifierGroups.flatMap((g) => g.modifiers).filter((m) => c.modifiers?.some((s) => s.modifierId === m.id));
  const variant = c.variantId ? p.variants.find((v) => v.id === c.variantId)?.name : null;
  return { name: p.name, unitPrice: base + mods.reduce((a, m) => a + m.priceDelta, 0), detail: [variant, ...mods.map((m) => m.name)].filter(Boolean).join(", ") };
}

/** Navigation du menu + panier, partagée par le QR à table, la commande en ligne et la borne. */
export function MenuBrowser({ catalog, cart, setCart, t, readOnly = false, big = false }: { catalog: PublicCatalog; cart: CartLine[]; setCart: (c: CartLine[]) => void; t: (k: Key) => string; readOnly?: boolean; big?: boolean }) {
  const [catId, setCatId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<{ product?: PosProduct; menu?: PosMenu } | null>(null);
  const cats = catalog.categories.filter((c) => !c.parentId);
  const products = useMemo(() => { const q = search.trim().toLowerCase(); return catalog.products.filter((p) => (q ? p.name.toLowerCase().includes(q) : !catId || p.categoryId === catId)); }, [catalog.products, catId, search]);
  const add = (choice: ProductChoice) => { const px = priceOf(catalog, choice); setCart([...cart, { ...choice, id: crypto.randomUUID(), ...px }]); };
  const qtyIn = (productId: string) => cart.filter((l) => l.productId === productId).reduce((a, l) => a + l.quantity, 0);
  const tile = big ? "h-52" : "h-44";
  return (
    <div>
      <div className="sticky top-0 z-10 -mx-1 mb-3 space-y-2 bg-[var(--bg)] px-1 py-2">
        <div className="card flex h-11 items-center gap-2 px-3 shadow-none"><Search className="h-4 w-4 text-muted" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search")} className="h-9 flex-1 bg-transparent text-sm outline-none" /></div>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          <button onClick={() => setCatId(null)} className={`touch h-10 shrink-0 rounded-full px-4 text-sm font-bold ${!catId ? "bg-brand text-white shadow-glow" : "card text-muted"}`}>{t("all")}</button>
          {cats.map((c) => <button key={c.id} onClick={() => setCatId(c.id)} className={`touch flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-bold ${catId === c.id ? "text-white shadow-lift" : "card text-muted"}`} style={catId === c.id ? { background: c.color } : undefined}><span className="h-2.5 w-2.5 rounded-full" style={{ background: catId === c.id ? "rgb(255 255 255 / .8)" : c.color }} />{c.name}</button>)}
          {catalog.menus.length ? <button onClick={() => setCatId("__menus__")} className={`touch h-10 shrink-0 rounded-full px-4 text-sm font-bold ${catId === "__menus__" ? "bg-brand text-white shadow-glow" : "card text-muted"}`}>Formules</button> : null}
        </div>
      </div>
      <div className={`grid gap-3 ${big ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"}`}>
        {catId === "__menus__" && !search ? catalog.menus.map((m) => (
          <button key={m.id} onClick={() => !readOnly && setOpen({ menu: m as unknown as PosMenu })} className={`card touch flex ${tile} flex-col overflow-hidden text-left`}>
            {m.imageUrl ? <img src={m.imageUrl} alt="" className="h-24 w-full object-cover" /> : <span className="bg-lagoon h-24 w-full" />}
            <span className="flex flex-1 flex-col justify-between p-3"><span className="font-bold leading-tight">{m.name}{m.description ? <span className="block text-xs font-normal text-muted">{m.description}</span> : null}</span><span className="font-extrabold text-brand"><Money amount={m.priceTtc} /></span></span>
          </button>
        )) : products.map((p) => {
          const cat = catalog.categories.find((c) => c.id === p.categoryId);
          const n = qtyIn(p.id);
          return (
            <div key={p.id} className={`card relative flex ${tile} flex-col overflow-hidden`}>
              <button onClick={() => !readOnly && setOpen({ product: p as unknown as PosProduct })} className="touch flex min-h-0 flex-1 flex-col text-left" aria-label={`${p.name} : détail`}>
                {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" className="h-24 w-full shrink-0 object-cover" /> : <span className="flex h-24 w-full shrink-0 items-center justify-center text-3xl font-extrabold text-white/90" style={{ background: `linear-gradient(140deg, color-mix(in srgb, ${p.color ?? cat?.color ?? "#14aaa3"} 85%, white), ${p.color ?? cat?.color ?? "#14aaa3"})` }}>{p.name.slice(0, 1)}</span>}
                <span className="flex min-h-0 flex-1 flex-col justify-between gap-1 p-3 pr-12"><span className="line-clamp-2 text-sm font-bold leading-tight">{p.name}{p.description ? <span className="line-clamp-1 text-xs font-normal text-muted">{p.description}</span> : null}</span><span className="flex items-center gap-1.5 text-sm font-extrabold"><Money amount={p.priceTtc} />{p.variants.length ? <span className="text-[10px] font-bold uppercase text-muted">{t("from")}</span> : null}{p.modifierGroups.length ? <span className="rounded-md surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted">{t("options")}</span> : null}</span></span>
              </button>
              {!readOnly ? <button onClick={() => { const needs = p.variants.length > 0 || p.modifierGroups.some((g) => g.minSelect > 0 && !g.modifiers.some((m) => m.isDefault)); if (needs) return setOpen({ product: p as unknown as PosProduct }); add({ productId: p.id, quantity: 1, modifiers: p.modifierGroups.flatMap((g) => g.modifiers.filter((m) => m.isDefault).slice(0, g.maxSelect ?? undefined).map((m) => ({ modifierId: m.id }))) }); }} className="touch absolute bottom-2 right-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white shadow-glow active:scale-90" aria-label={`${t("add")} ${p.name}`}>{n > 0 ? <span className="text-sm font-extrabold">{n}</span> : <Plus className="h-5 w-5" />}</button> : null}
            </div>
          );
        })}
        {products.length === 0 && catId !== "__menus__" ? <p className="col-span-full py-10 text-center text-sm text-muted">—</p> : null}
      </div>
      {open?.product ? <ProductModal product={open.product} onClose={() => setOpen(null)} onAdd={async (c) => add(c)} /> : null}
      {open?.menu ? <ProductModal menu={open.menu} products={catalog.products as unknown as PosProduct[]} onClose={() => setOpen(null)} onAdd={async (c) => add(c)} /> : null}
    </div>
  );
}

/** Panier : lignes, quantités, total, bouton d'action. */
export function Cart({ cart, setCart, t, action, actionLabel, disabled, extra, note, setNote }: { cart: CartLine[]; setCart: (c: CartLine[]) => void; t: (k: Key) => string; action?: () => void; actionLabel?: string; disabled?: boolean; extra?: { label: string; amount: number }[]; note?: string; setNote?: (v: string) => void }) {
  const subtotal = cart.reduce((a, l) => a + l.unitPrice * l.quantity, 0);
  const total = subtotal + (extra ?? []).reduce((a, e) => a + e.amount, 0);
  const setQty = (id: string, q: number) => setCart(q <= 0 ? cart.filter((l) => l.id !== id) : cart.map((l) => (l.id === id ? { ...l, quantity: q } : l)));
  return (
    <div className="card p-4">
      <p className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-muted"><ShoppingBasket className="h-4 w-4" />{t("cart")}</p>
      {cart.length === 0 ? <p className="py-6 text-center text-sm text-muted">{t("empty")}</p> : null}
      <ul className="divide-y divide-[var(--border)]">
        {cart.map((l) => (
          <li key={l.id} className="flex items-center gap-2 py-2">
            <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{l.name}</span>{l.detail ? <span className="block text-xs text-muted">{l.detail}</span> : null}{l.notes ? <span className="block text-xs italic text-corail-500">« {l.notes} »</span> : null}</span>
            <span className="flex items-center rounded-lg border border-line"><button onClick={() => setQty(l.id, l.quantity - 1)} className="touch h-9 w-9 text-lg" aria-label="−">{l.quantity === 1 ? <Trash2 className="mx-auto h-4 w-4 text-red-500" /> : <Minus className="mx-auto h-4 w-4" />}</button><span className="w-7 text-center text-sm font-bold">{l.quantity}</span><button onClick={() => setQty(l.id, l.quantity + 1)} className="touch h-9 w-9" aria-label="+"><Plus className="mx-auto h-4 w-4" /></button></span>
            <span className="w-20 text-right text-sm font-extrabold"><Money amount={l.unitPrice * l.quantity} /></span>
          </li>
        ))}
      </ul>
      {setNote ? <input value={note ?? ""} onChange={(e) => setNote(e.target.value)} placeholder={t("notes")} className="mt-2 h-11 w-full rounded-xl border border-line surface px-3 text-sm" /> : null}
      {(extra ?? []).map((e) => <div key={e.label} className="mt-2 flex justify-between text-sm text-muted"><span>{e.label}</span><Money amount={e.amount} /></div>)}
      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3 text-lg font-extrabold"><span>{t("total")}</span><Money amount={total} className="text-2xl" /></div>
      {action ? <Button size="lg" className="mt-3 w-full" disabled={disabled || cart.length === 0} onClick={action}>{actionLabel}</Button> : null}
    </div>
  );
}

export function toLines(cart: CartLine[]) {
  return cart.map(({ id, productId, menuId, variantId, quantity, modifiers, menuSelections, notes }) => ({ id, productId, menuId, variantId, quantity, modifiers, menuSelections, notes }));
}
