"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useAction } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea, Toggle } from "@/components/ui/field";
import { EVENT_KINDS, type EventKind, type EventLine, type EventStatus, type EventTaxRow, type CateringMethod } from "@/lib/catering";
import { dateToZonedInput, zonedInputToDate } from "@/lib/dates";

export type EventSummary = {
  id: string; title: string; kind: EventKind; status: EventStatus; startsAt: string; endsAt: string; guests: number; location: string | null; privatize: boolean;
  clientName?: string; clientCompany?: string | null; totalTtc?: number; depositAmount?: number; paid?: number; quoteNumber?: string | null; invoiceNumber?: string | null; validUntil?: string | null;
};
export type EventDetail = {
  id: string; title: string; kind: EventKind; status: EventStatus; startsAt: string; endsAt: string; guests: number; location: string | null; privatize: boolean;
  clientName: string; clientCompany: string | null; clientTahitiNumber: string | null; clientEmail: string | null; clientPhone: string | null; clientAddress: string | null;
  lines: EventLine[]; taxes: EventTaxRow[]; totalTtc: number; totalTax: number; totalHt: number; depositAmount: number; quoteNotes: string | null; kitchenNotes: string | null; internalNotes: string | null;
  quoteNumber: string | null; quoteSentAt: string | null; validUntil: string | null; publicToken: string; acceptedAt: string | null; acceptedBy: string | null;
  invoiceNumber: string | null; invoicedAt: string | null; invoiceDueAt: string | null; cancelledAt: string | null; cancelReason: string | null;
  payments: { id: string; kind: "DEPOSIT" | "BALANCE" | "REFUND"; amount: number; method: CateringMethod; reference: string | null; receivedAt: string }[];
  paid: number; remaining: number; depositDue: number;
};

/** Création / modification d'un événement : quoi, quand, où, pour qui. Les lignes du devis se composent sur la fiche. */
export function EventForm({ event, onClose }: { event?: EventDetail; onClose: () => void }) {
  const act = useAction();
  const router = useRouter();
  const { timezone } = useSession();
  const start = event ? dateToZonedInput(event.startsAt, timezone) : "";
  const [f, setF] = useState({
    title: event?.title ?? "", kind: event?.kind ?? ("BUFFET" as EventKind), day: start.slice(0, 10), from: start.slice(11, 16) || "18:00",
    to: event ? dateToZonedInput(event.endsAt, timezone).slice(11, 16) : "23:00", guests: String(event?.guests ?? ""), location: event?.location ?? "", privatize: event?.privatize ?? false,
    clientName: event?.clientName ?? "", clientCompany: event?.clientCompany ?? "", clientTahitiNumber: event?.clientTahitiNumber ?? "", clientEmail: event?.clientEmail ?? "", clientPhone: event?.clientPhone ?? "",
    clientAddress: event?.clientAddress ?? "", quoteNotes: event?.quoteNotes ?? "", kitchenNotes: event?.kitchenNotes ?? "", internalNotes: event?.internalNotes ?? "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const guests = Number(f.guests);
  const valid = f.title.trim() && f.clientName.trim() && /^\d{4}-\d{2}-\d{2}$/.test(f.day) && f.from && f.to && Number.isInteger(guests) && guests > 0;
  const save = async () => {
    if (!valid) return;
    const startsAt = zonedInputToDate(`${f.day}T${f.from}`, timezone);
    let endsAt = zonedInputToDate(`${f.day}T${f.to}`, timezone);
    if (endsAt <= startsAt) endsAt = new Date(endsAt.getTime() + 86_400_000); // fin après minuit
    const body = {
      title: f.title, kind: f.kind, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), guests, location: f.location || null, privatize: f.privatize,
      clientName: f.clientName, clientCompany: f.clientCompany || null, clientTahitiNumber: f.clientTahitiNumber || null, clientEmail: f.clientEmail || null, clientPhone: f.clientPhone || null,
      clientAddress: f.clientAddress || null, quoteNotes: f.quoteNotes || null, kitchenNotes: f.kitchenNotes || null, internalNotes: f.internalNotes || null,
    };
    const r = await act(() => (event ? api.patch<EventDetail>(`/api/catering/${event.id}`, body) : api.post<EventDetail>("/api/catering", body)), { success: event ? "Événement mis à jour" : "Événement créé : composez maintenant le devis", invalidate: [["catering"]] });
    if (r) { onClose(); if (!event) router.push(`/admin/catering/${r.id}`); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={event ? "Modifier l'événement" : "Nouvel événement"} footer={<Button size="lg" className="w-full" onClick={save} disabled={!valid} data-testid="event-save">{event ? "Enregistrer" : "Créer l'événement"}</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom de l'événement" className="sm:col-span-2"><Input autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="ex. Mariage de Teva et Hina" aria-label="Nom de l'événement" /></Field>
        <Field label="Type"><Select value={f.kind} onChange={(e) => set("kind", e.target.value as EventKind)} aria-label="Type d'événement">{Object.entries(EVENT_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Nombre de personnes"><Input inputMode="numeric" value={f.guests} onChange={(e) => set("guests", e.target.value.replace(/\D/g, ""))} aria-label="Nombre de personnes" /></Field>
        <Field label="Date"><Input type="date" value={f.day} onChange={(e) => set("day", e.target.value)} aria-label="Date de l'événement" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="De"><Input type="time" value={f.from} onChange={(e) => set("from", e.target.value)} aria-label="Heure de début" /></Field>
          <Field label="À"><Input type="time" value={f.to} onChange={(e) => set("to", e.target.value)} aria-label="Heure de fin" /></Field>
        </div>
        <Field label="Lieu" hint="Vide : au restaurant" className="sm:col-span-2"><Input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="ex. Plage de Toaroto, Punaauia" aria-label="Lieu" /></Field>
        <div className="sm:col-span-2"><Toggle checked={f.privatize} onChange={(v) => set("privatize", v)} label="Restaurant privatisé : réservations en ligne fermées pendant l'événement (une fois confirmé)" /></div>

        <p className="mt-2 text-sm font-extrabold sm:col-span-2">Client</p>
        <Field label="Nom du client"><Input value={f.clientName} onChange={(e) => set("clientName", e.target.value)} aria-label="Nom du client" /></Field>
        <Field label="Entreprise (facultatif)"><Input value={f.clientCompany} onChange={(e) => set("clientCompany", e.target.value)} aria-label="Entreprise" /></Field>
        <Field label="E-mail (devis et lien d'acceptation)"><Input type="email" value={f.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} aria-label="E-mail du client" /></Field>
        <Field label="Téléphone"><Input value={f.clientPhone} onChange={(e) => set("clientPhone", e.target.value)} aria-label="Téléphone du client" /></Field>
        <Field label="N° Tahiti (entreprise)"><Input value={f.clientTahitiNumber} onChange={(e) => set("clientTahitiNumber", e.target.value)} aria-label="N° Tahiti du client" /></Field>
        <Field label="Adresse de facturation"><Input value={f.clientAddress} onChange={(e) => set("clientAddress", e.target.value)} aria-label="Adresse du client" /></Field>

        <p className="mt-2 text-sm font-extrabold sm:col-span-2">Notes</p>
        <Field label="Précisions imprimées sur le devis" className="sm:col-span-2"><Textarea rows={2} value={f.quoteNotes} onChange={(e) => set("quoteNotes", e.target.value)} placeholder="Déroulé, matériel fourni, conditions…" aria-label="Précisions du devis" /></Field>
        <Field label="Pour la cuisine (fiche cuisine)"><Textarea rows={2} value={f.kitchenNotes} onChange={(e) => set("kitchenNotes", e.target.value)} placeholder="Allergies, heure du service, gâteau…" aria-label="Notes cuisine" /></Field>
        <Field label="Notes internes"><Textarea rows={2} value={f.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} placeholder="Jamais montrées au client" aria-label="Notes internes" /></Field>
      </div>
    </Modal>
  );
}
