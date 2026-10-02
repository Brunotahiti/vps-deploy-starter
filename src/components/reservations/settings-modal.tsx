"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type { ReservationSettings } from "@/lib/reservations";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Select, Toggle } from "@/components/ui/field";
import { useAction } from "@/components/admin/common";

/** Réglages simples : heures des services, écart entre les créneaux, temps à table et couverts au plus par service. */
export function ReservationSettingsModal(props: { open: boolean; onClose: () => void; settings: ReservationSettings }) {
  return props.open ? <SettingsForm {...props} /> : null;
}

function SettingsForm({ open, onClose, settings }: { open: boolean; onClose: () => void; settings: ReservationSettings }) {
  const act = useAction();
  const [s, setS] = useState(settings);
  const save = async () => {
    const r = await act(() => api.put("/api/reservations/settings", s), { success: "Réglages enregistrés", invalidate: [["reservation-settings"]] });
    if (r) onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Réglages des réservations" size="md" footer={<Button className="w-full" onClick={save}>Enregistrer</Button>}>
      <div className="space-y-4">
        {s.services.map((svc, i) => (
          <div key={svc.key} className="flex flex-wrap items-center gap-3 rounded-2xl surface-2 p-3">
            <Toggle checked={svc.enabled} onChange={(v) => setS({ ...s, services: s.services.map((x, j) => (j === i ? { ...x, enabled: v } : x)) })} label={`Service du ${svc.label.toLowerCase()}`} />
            <span className="ml-auto flex items-center gap-2 text-sm">de <Input aria-label={`Début ${svc.label}`} type="time" value={svc.from} disabled={!svc.enabled} onChange={(e) => setS({ ...s, services: s.services.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)) })} className="w-28!" />
              à <Input aria-label={`Dernière arrivée ${svc.label}`} type="time" value={svc.to} disabled={!svc.enabled} onChange={(e) => setS({ ...s, services: s.services.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)) })} className="w-28!" /></span>
          </div>
        ))}
        <p className="-mt-2 text-xs text-muted">La seconde heure est la dernière arrivée possible.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-semibold">Créneaux tous les
            <Select value={s.interval} onChange={(e) => setS({ ...s, interval: Number(e.target.value) })} className="mt-1">{[10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m === 60 ? "1 heure" : `${m} minutes`}</option>)}</Select>
          </label>
          <label className="text-sm font-semibold">Temps à table
            <Select value={s.duration} onChange={(e) => setS({ ...s, duration: Number(e.target.value) })} className="mt-1">{[60, 90, 120, 150, 180].map((m) => <option key={m} value={m}>{m === 60 ? "1 h" : m === 90 ? "1 h 30" : `${Math.floor(m / 60)} h${m % 60 ? " 30" : ""}`}</option>)}</Select>
          </label>
          <label className="text-sm font-semibold">Couverts max. par service
            <Input type="number" min={1} placeholder="Sans limite" value={s.capacity ?? ""} onChange={(e) => setS({ ...s, capacity: e.target.value ? Math.max(1, Number(e.target.value)) : null })} className="mt-1" />
          </label>
        </div>
        <p className="text-xs text-muted">Le temps à table évite de donner deux fois la même table. Le maximum de couverts prévient quand un service est complet, sans rien bloquer.</p>
      </div>
    </Modal>
  );
}
