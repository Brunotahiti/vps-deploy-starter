"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/money";
import { formatMoney } from "@/lib/money";
import { useSession } from "@/hooks/use-session";
import type { PosMenu, PosProduct } from "./types";

type ModSel = { modifierId: string; quantity?: number }[];
export type ProductChoice = { productId?: string; menuId?: string; variantId?: string | null; quantity: number; modifiers?: ModSel; menuSelections?: { sectionId: string; productId: string; modifiers?: ModSel }[]; notes?: string | null };

function ModifierGroups({ groups, value, onChange }: { groups: PosProduct["modifierGroups"]; value: ModSel; onChange: (v: ModSel) => void }) {
  const { currency } = useSession();
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const selected = value.filter((v) => g.modifiers.some((m) => m.id === v.modifierId));
        const single = g.maxSelect === 1;
        return (
          <div key={g.id}>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="font-bold">{g.name}</h4>
              <span className={`text-xs font-semibold ${g.minSelect > 0 && selected.length < g.minSelect ? "text-corail-500" : "text-muted"}`}>{g.minSelect > 0 ? "Obligatoire" : "Facultatif"}{g.maxSelect ? ` · max ${g.maxSelect}` : ""}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {g.modifiers.map((m) => {
                const on = value.some((v) => v.modifierId === m.id);
                return (
                  <button
                    key={m.id} type="button" disabled={!m.isAvailable}
                    onClick={() => {
                      if (single) onChange([...value.filter((v) => !g.modifiers.some((x) => x.id === v.modifierId)), { modifierId: m.id }]);
                      else if (on) onChange(value.filter((v) => v.modifierId !== m.id));
                      else if (!g.maxSelect || selected.length < g.maxSelect) onChange([...value, { modifierId: m.id }]);
                    }}
                    className={`touch flex h-14 flex-col items-center justify-center rounded-xl border px-2 text-sm font-semibold transition ${on ? "border-lagon-500 bg-lagon-500/15 text-lagon-700 dark:text-lagon-200" : "border-line surface-2"} disabled:opacity-40`}
                  >
                    <span className="truncate">{m.name}</span>
                    {m.priceDelta !== 0 ? <span className="text-xs text-muted">{m.priceDelta > 0 ? "+" : ""}{formatMoney(m.priceDelta, currency)}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProductModal({ product, menu, products = [], onClose, onAdd }: { product?: PosProduct | null; menu?: PosMenu | null; products?: PosProduct[]; onClose: () => void; onAdd: (choice: ProductChoice) => Promise<void> }) {
  const [qty, setQty] = useState(1);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [mods, setMods] = useState<ModSel>(() => product?.modifierGroups.flatMap((g) => g.modifiers.filter((m) => m.isDefault).slice(0, g.maxSelect ?? undefined).map((m) => ({ modifierId: m.id }))) ?? []);
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [menuMods, setMenuMods] = useState<Record<string, ModSel>>({});
  const productOf = (id: string) => products.find((p) => p.id === id);
  const defaultMods = (p: PosProduct | undefined): ModSel => p?.modifierGroups.flatMap((g) => g.modifiers.filter((m) => m.isDefault).slice(0, g.maxSelect ?? undefined).map((m) => ({ modifierId: m.id }))) ?? [];
  const groupsValid = (groups: PosProduct["modifierGroups"], sel: ModSel) => groups.every((g) => { const n = sel.filter((v) => g.modifiers.some((m) => m.id === v.modifierId)).length; return n >= g.minSelect && (!g.maxSelect || n <= g.maxSelect); });
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  const unit = useMemo(() => {
    if (menu) {
      const sup = menu.sections.reduce((a, s) => a + (selections[s.id] ?? []).reduce((b, pid) => b + (s.items.find((i) => i.productId === pid)?.supplement ?? 0), 0), 0);
      const extra = Object.entries(menuMods).reduce((a, [pid, sel]) => a + (productOf(pid)?.modifierGroups.flatMap((g) => g.modifiers).filter((m) => sel.some((x) => x.modifierId === m.id)).reduce((b, m) => b + m.priceDelta, 0) ?? 0), 0);
      return menu.priceTtc + sup + extra;
    }
    if (!product) return 0;
    const base = variantId ? (product.variants.find((v) => v.id === variantId)?.priceTtc ?? product.priceTtc) : product.priceTtc;
    const extra = product.modifierGroups.flatMap((g) => g.modifiers).filter((m) => mods.some((s) => s.modifierId === m.id)).reduce((a, m) => a + m.priceDelta, 0);
    return base + extra;
  }, [menu, product, variantId, mods, selections, menuMods]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = useMemo(() => {
    if (menu) return menu.sections.every((s) => (selections[s.id]?.length ?? 0) >= s.minSelect && (selections[s.id]?.length ?? 0) <= s.maxSelect) && Object.values(selections).flat().every((pid) => { const p = productOf(pid); return !p || groupsValid(p.modifierGroups, menuMods[pid] ?? []); });
    if (!product) return false;
    if (product.variants.length > 0 && !variantId) return false;
    return product.modifierGroups.every((g) => { const n = mods.filter((v) => g.modifiers.some((m) => m.id === v.modifierId)).length; return n >= g.minSelect && (!g.maxSelect || n <= g.maxSelect); });
  }, [menu, product, variantId, mods, selections, menuMods]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!valid) return;
    setLoading(true);
    try {
      if (menu) await onAdd({ menuId: menu.id, quantity: qty, notes: notes || null, menuSelections: menu.sections.flatMap((s) => (selections[s.id] ?? []).map((productId) => ({ sectionId: s.id, productId, modifiers: menuMods[productId] ?? [] }))) });
      else if (product) await onAdd({ productId: product.id, variantId, quantity: qty, modifiers: mods, notes: notes || null });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const title = menu?.name ?? product?.name ?? "";
  return (
    <Modal open={!!(product || menu)} onClose={onClose} title={title} size="lg" footer={
      <div className="flex items-center gap-3">
        <div className="flex items-center rounded-xl border border-line">
          <button className="touch h-12 w-12 text-xl font-bold" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
          <span className="w-10 text-center text-lg font-bold">{qty}</span>
          <button className="touch h-12 w-12 text-xl font-bold" onClick={() => setQty((q) => q + 1)}>+</button>
        </div>
        <Button size="lg" className="flex-1" disabled={!valid} loading={loading} onClick={submit}>Ajouter · <Money amount={unit * qty} /></Button>
      </div>
    }>
      {/* eslint-disable-next-line @next/next/no-img-element -- image du catalogue (URL libre) */}
      {(product?.imageUrl || menu?.imageUrl) ? <img src={(product?.imageUrl || menu?.imageUrl) ?? ""} alt="" className="mb-3 h-44 w-full rounded-2xl object-cover shadow-soft sm:h-56" /> : null}
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted">{product?.description || menu?.description || (product?.modifierGroups.length || product?.variants.length ? "Choisissez les options puis ajoutez à la commande." : "Aucune option : ajustez la quantité puis ajoutez à la commande.")}</p>
        <span className="shrink-0 rounded-full bg-lagon-500/15 px-3 py-1 text-base font-extrabold text-lagon-700 dark:text-lagon-200"><Money amount={product ? (product.variants.length ? Math.min(...product.variants.map((v) => v.priceTtc)) : product.priceTtc) : (menu?.priceTtc ?? 0)} /></span>
      </div>
      {product && product.variants.length > 0 ? (
        <div className="mb-4">
          <h4 className="mb-2 font-bold">Taille / variante</h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {product.variants.map((v) => (
              <button key={v.id} onClick={() => setVariantId(v.id)} className={`touch h-14 rounded-xl border text-sm font-semibold ${variantId === v.id ? "border-lagon-500 bg-lagon-500/15" : "border-line surface-2"}`}>{v.name}<br /><span className="text-xs text-muted"><Money amount={v.priceTtc} /></span></button>
            ))}
          </div>
        </div>
      ) : null}
      {product ? <ModifierGroups groups={product.modifierGroups} value={mods} onChange={setMods} /> : null}
      {menu ? (
        <div className="space-y-4">
          {menu.sections.map((s) => (
            <div key={s.id}>
              <div className="mb-2 flex items-center justify-between"><h4 className="font-bold">{s.name}</h4><span className="text-xs font-semibold text-muted">{s.minSelect > 0 ? "Obligatoire" : "Facultatif"} · {s.maxSelect > 1 ? `max ${s.maxSelect}` : "1 choix"}</span></div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {s.items.map((it) => {
                  const on = (selections[s.id] ?? []).includes(it.productId);
                  const unavailable = !it.product.isAvailable || !it.product.isActive;
                  return (
                    <button key={it.id} disabled={unavailable} onClick={() => { setSelections((cur) => { const list = cur[s.id] ?? []; const next = s.maxSelect === 1 ? [it.productId] : on ? list.filter((x) => x !== it.productId) : list.length < s.maxSelect ? [...list, it.productId] : list; return { ...cur, [s.id]: next }; }); if (!on && !menuMods[it.productId]) setMenuMods((m) => ({ ...m, [it.productId]: defaultMods(productOf(it.productId)) })); }}
                      className={`touch flex h-16 flex-col items-center justify-center rounded-xl border px-2 text-sm font-semibold ${on ? "border-lagon-500 bg-lagon-500/15" : "border-line surface-2"} disabled:opacity-40`}>
                      <span className="line-clamp-2 text-center">{it.product.name}</span>
                      {it.supplement > 0 ? <span className="text-xs text-corail-500">+<Money amount={it.supplement} /></span> : null}
                    </button>
                  );
                })}
              </div>
              {(selections[s.id] ?? []).map((pid) => { const p = productOf(pid); if (!p || p.modifierGroups.length === 0) return null; return <div key={pid} className="mt-3 rounded-xl border border-line p-3"><p className="mb-2 text-sm font-semibold">{p.name} — options</p><ModifierGroups groups={p.modifierGroups} value={menuMods[pid] ?? []} onChange={(v) => setMenuMods((m) => ({ ...m, [pid]: v }))} /></div>; })}
            </div>
          ))}
        </div>
      ) : null}
      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-semibold uppercase text-muted">Note cuisine</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="sans oignons, allergie…" className="h-11 w-full rounded-xl border border-line surface px-3 text-sm" />
      </label>
    </Modal>
  );
}
