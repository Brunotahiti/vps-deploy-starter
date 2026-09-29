"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Spinner, Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { addDays, formatTime, localDay } from "@/lib/dates";
import { useAction } from "@/components/admin/common";
import { useFloor } from "./floor";
import type { listReservations } from "@/server/services/reservations";

type R = Awaited<ReturnType<typeof listReservations>>[number];
const STATUS: Record<string, [string, "gray" | "green" | "orange" | "red" | "blue" | "purple" | "teal"]> = { PENDING: ["À confirmer", "orange"], CONFIRMED: ["Confirmée", "blue"], ARRIVED: ["Arrivée", "teal"], SEATED: ["Installée", "green"], COMPLETED: ["Terminée", "gray"], CANCELLED: ["Annulée", "red"], NO_SHOW: ["No-show", "red"] };
const toLocal = (d: Date | string) => { const x = new Date(d); const p = (n: number) => String(n).padStart(2, "0"); return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`; };

/** Réservations du jour : prise, confirmation, arrivée, installation (ouvre la commande), no-show. */
export function ReservationsScreen() {
  const router = useRouter();
  const { toast } = useToast();
  const { timezone, can } = useSession();
  const act = useAction();
  const [day, setDay] = useState(localDay(new Date(), timezone));
  const q = useQuery({ queryKey: ["reservations", day], queryFn: () => api.get<R[]>(`/api/reservations?day=${day}`), refetchInterval: 30_000 });
  const floor = useFloor();
  const tables = (floor.data?.rooms ?? []).flatMap((r) => r.tables.map((t) => ({ ...t, room: r.name })));
  const [edit, setEdit] = useState<{ id?: string; name: string; phone: string; email: string; startsAt: string; partySize: string; tableId: string; notes: string; allergies: string } | null>(null);
  const [seat, setSeat] = useState<R | null>(null);
  const save = async () => {
    if (!edit) return;
    const body = { name: edit.name, phone: edit.phone || null, email: edit.email || null, startsAt: new Date(edit.startsAt).toISOString(), partySize: Number(edit.partySize), tableId: edit.tableId || null, notes: edit.notes || null, allergies: edit.allergies || null };
    const r = await act(() => (edit.id ? api.patch(`/api/reservations/${edit.id}`, body) : api.post("/api/reservations", body)), { success: "Réservation enregistrée", invalidate: [["reservations"], ["floor"]] });
    if (r) setEdit(null);
  };
  const setStatus = async (r: R, status: string, tableId?: string | null) => {
    const res = await act(() => api.post<{ orderId: string | null }>(`/api/reservations/${r.id}/status`, { status, tableId }), { invalidate: [["reservations"], ["floor"], ["orders"]] });
    if (res?.orderId) { toast(`Table ouverte pour ${r.name}`, "success"); router.push(`/pos/order/${res.orderId}`); }
    setSeat(null);
  };
  const list = q.data ?? [];
  const pending = list.filter((r) => r.status === "PENDING").length;
  return (
    <div className="mx-auto max-w-4xl overflow-y-auto p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => setDay(addDays(day, -1))} className="touch h-11 rounded-xl surface-2 px-3 font-bold">‹</button>
        <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="w-40!" />
        <button onClick={() => setDay(addDays(day, 1))} className="touch h-11 rounded-xl surface-2 px-3 font-bold">›</button>
        {pending ? <Badge color="orange">{pending} à confirmer</Badge> : null}
        <span className="text-sm text-muted">{list.reduce((a, r) => (r.status !== "CANCELLED" && r.status !== "NO_SHOW" ? a + r.partySize : a), 0)} couverts attendus</span>
        {can("customers.manage") ? <Button className="ml-auto" onClick={() => setEdit({ name: "", phone: "", email: "", startsAt: `${day}T19:30`, partySize: "2", tableId: "", notes: "", allergies: "" })}>Nouvelle réservation</Button> : null}
      </div>
      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : null}
      {!q.isLoading && list.length === 0 ? <p className="py-10 text-center text-sm text-muted">Aucune réservation ce jour</p> : null}
      <div className="space-y-2">
        {list.map((r) => (
          <div key={r.id} className="card flex flex-wrap items-center gap-3 p-3">
            <div className="flex h-12 w-14 flex-col items-center justify-center rounded-lg surface-2 text-sm font-extrabold">{formatTime(r.startsAt, timezone)}</div>
            <div className="min-w-0 flex-1">
              <p className="font-bold">{r.name} <span className="font-normal text-muted">· {r.partySize} pers.{r.table ? ` · table ${r.table.name}` : ""}</span>{r.customer && r.customer.visitCount > 0 ? <span className="ml-2 rounded bg-lagon-500/15 px-1.5 text-[10px] font-bold text-lagon-700">{r.customer.visitCount} visite{r.customer.visitCount > 1 ? "s" : ""}</span> : null}</p>
              <p className="text-xs text-muted">{[r.phone, r.notes, r.allergies ? `⚠ ${r.allergies}` : null].filter(Boolean).join(" · ")}</p>
            </div>
            <Badge color={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>
            <div className="flex flex-wrap gap-1">
              {r.status === "PENDING" ? <><Button size="sm" onClick={() => setStatus(r, "CONFIRMED")}>Confirmer</Button><Button size="sm" variant="ghost" onClick={() => setStatus(r, "CANCELLED")}>Refuser</Button></> : null}
              {r.status === "CONFIRMED" ? <><Button size="sm" variant="secondary" onClick={() => setStatus(r, "ARRIVED")}>Arrivée</Button><Button size="sm" onClick={() => setSeat(r)}>Installer</Button><Button size="sm" variant="ghost" onClick={() => setStatus(r, "NO_SHOW")}>No-show</Button></> : null}
              {r.status === "ARRIVED" ? <Button size="sm" onClick={() => setSeat(r)}>Installer</Button> : null}
              {r.status === "SEATED" ? <Button size="sm" variant="secondary" onClick={() => setStatus(r, "COMPLETED")}>Terminée</Button> : null}
              {(r.status === "CANCELLED" || r.status === "NO_SHOW") ? <Button size="sm" variant="ghost" onClick={() => setStatus(r, "CONFIRMED")}>Rétablir</Button> : null}
              {can("customers.manage") && r.status !== "COMPLETED" ? <Button size="sm" variant="ghost" onClick={() => setEdit({ id: r.id, name: r.name, phone: r.phone ?? "", email: r.email ?? "", startsAt: toLocal(r.startsAt), partySize: String(r.partySize), tableId: r.tableId ?? "", notes: r.notes ?? "", allergies: r.allergies ?? "" })}>Modifier</Button> : null}
            </div>
          </div>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Modifier la réservation" : "Nouvelle réservation"} size="md" footer={<Button className="w-full" disabled={!edit?.name} onClick={save}>Enregistrer</Button>}>
        {edit ? <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom" className="sm:col-span-2"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Téléphone"><Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
          <Field label="Email"><Input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
          <Field label="Date et heure"><Input type="datetime-local" value={edit.startsAt} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} /></Field>
          <Field label="Personnes"><Input type="number" min={1} value={edit.partySize} onChange={(e) => setEdit({ ...edit, partySize: e.target.value })} /></Field>
          <Field label="Table (facultatif)"><Select value={edit.tableId} onChange={(e) => setEdit({ ...edit, tableId: e.target.value })}><option value="">—</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.room} · {t.name} ({t.seats} pl.)</option>)}</Select></Field>
          <Field label="Allergies"><Input value={edit.allergies} onChange={(e) => setEdit({ ...edit, allergies: e.target.value })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
        </div> : null}
      </Modal>
      <Modal open={!!seat} onClose={() => setSeat(null)} title={seat ? `Installer ${seat.name} (${seat.partySize} pers.)` : ""} size="lg">
        <p className="mb-3 text-sm text-muted">Choisissez la table : la commande s&apos;ouvre avec {seat?.partySize} couvert{(seat?.partySize ?? 0) > 1 ? "s" : ""} et le client rattaché.</p>
        {(floor.data?.rooms ?? []).map((room) => <div key={room.id} className="mb-3"><p className="mb-1 text-xs font-bold uppercase text-muted">{room.name}</p><div className="grid grid-cols-4 gap-2 sm:grid-cols-6">{room.tables.map((t) => <button key={t.id} disabled={!!t.order} onClick={() => seat && setStatus(seat, "SEATED", t.id)} className={`touch h-14 rounded-xl text-sm font-bold disabled:opacity-30 ${seat?.tableId === t.id ? "bg-brand text-white" : "surface-2"}`}>{t.name}<br /><span className="text-xs font-normal opacity-80">{t.seats} pl.</span></button>)}</div></div>)}
      </Modal>
    </div>
  );
}
