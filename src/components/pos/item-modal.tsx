"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Money } from "@/components/money";
import { Trash2, AlertTriangle } from "lucide-react";
import type { Order, OrderItem } from "./types";

export function ItemModal({ order, item, onClose, onUpdate, onRemove }: {
  order: Order; item: OrderItem | null; onClose: () => void;
  onUpdate: (itemId: string, patch: { quantity?: number; seatNumber?: number | null; courseId?: string | null; notes?: string | null; isUrgent?: boolean }) => Promise<void>;
  onRemove: (item: OrderItem, reason: string | null) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [loading, setLoading] = useState(false);
  if (!item) return null;
  const sent = item.status !== "PENDING";
  const wrap = (fn: () => Promise<void>) => async () => { setLoading(true); try { await fn(); } finally { setLoading(false); } };
  return (
    <Modal open onClose={onClose} title={item.name} size="md">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">{sent ? "Déjà envoyé en cuisine" : "Non envoyé"} · <Money amount={item.unitPrice + item.modifiersTotal} /> l&apos;unité</span>
          <span className="text-lg font-bold"><Money amount={item.lineTotal} /></span>
        </div>
        {item.modifiers.length ? <p className="text-sm text-muted">{item.modifiers.map((m) => m.name).join(", ")}</p> : null}
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted">Quantité</p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="lg" disabled={sent || item.quantity <= 1 || loading} onClick={wrap(() => onUpdate(item.id, { quantity: item.quantity - 1 }))}>−</Button>
            <span className="w-12 text-center text-2xl font-bold">{item.quantity}</span>
            <Button variant="secondary" size="lg" disabled={sent || loading} onClick={wrap(() => onUpdate(item.id, { quantity: item.quantity + 1 }))}>+</Button>
            {sent ? <span className="text-xs text-muted">La quantité d&apos;un article envoyé ne se modifie pas : supprimez-le avec un motif.</span> : null}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-muted">Client</p>
          <div className="flex flex-wrap gap-2">
            <button disabled={loading} onClick={wrap(() => onUpdate(item.id, { seatNumber: null }))} className={`touch h-11 rounded-xl px-3 text-sm font-semibold ${item.seatNumber === null ? "bg-lagon-600 text-white" : "surface-2"}`}>Table entière</button>
            {Array.from({ length: Math.max(order.covers, 1) }, (_, i) => i + 1).map((n) => (
              <button key={n} disabled={loading} onClick={wrap(() => onUpdate(item.id, { seatNumber: n }))} className={`touch h-11 w-14 rounded-xl text-sm font-semibold ${item.seatNumber === n ? "bg-lagon-600 text-white" : "surface-2"}`}>C{n}</button>
            ))}
          </div>
        </div>
        {order.courses.length > 1 ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-muted">Service</p>
            <div className="flex flex-wrap gap-2">
              {order.courses.map((c) => (
                <button key={c.id} disabled={loading || sent} onClick={wrap(() => onUpdate(item.id, { courseId: c.id }))} className={`touch h-11 rounded-xl px-3 text-sm font-semibold ${item.courseId === c.id ? "bg-lagon-600 text-white" : "surface-2"} disabled:opacity-50`}>{c.name}</button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <Button variant={item.isUrgent ? "accent" : "secondary"} disabled={loading} onClick={wrap(() => onUpdate(item.id, { isUrgent: !item.isUrgent }))}><AlertTriangle className="h-4 w-4" /> {item.isUrgent ? "Urgent ✓" : "Marquer urgent"}</Button>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase text-muted">Note cuisine</span>
          <div className="flex gap-2">
            <input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-11 flex-1 rounded-xl border border-line surface px-3 text-sm" placeholder="sans oignons…" />
            <Button variant="secondary" disabled={loading || notes === (item.notes ?? "")} onClick={wrap(() => onUpdate(item.id, { notes: notes || null }))}>Enregistrer</Button>
          </div>
        </label>
        <div className="rounded-xl border border-red-500/30 p-3">
          {sent ? (
            <label className="mb-2 block">
              <span className="mb-1 block text-xs font-semibold uppercase text-red-600">Motif de suppression (tracé)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="h-11 w-full rounded-xl border border-line surface px-3 text-sm" placeholder="erreur de saisie, client parti…" />
            </label>
          ) : null}
          <Button variant="danger" className="w-full" size="lg" disabled={loading || (sent && !reason)} onClick={wrap(() => onRemove(item, sent ? reason : null))}><Trash2 className="h-5 w-5" /> {sent ? "Supprimer (autorisation manager)" : "Retirer du ticket"}</Button>
        </div>
      </div>
    </Modal>
  );
}
