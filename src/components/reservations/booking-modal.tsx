"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarCheck, Check, Phone, Sparkles, TriangleAlert, UserRound } from "lucide-react";
import { api } from "@/lib/api-client";
import { addDays, localDay, zonedInputToDate } from "@/lib/dates";
import { RESERVATION_SOURCES, RESERVATION_TAGS, phoneKey, serviceSlots, type ReservationSettings, type ReservationSource } from "@/lib/reservations";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input, Toggle } from "@/components/ui/field";
import { useAction } from "@/components/admin/common";
import { DatePicker } from "./date-picker";
import { counts, hhmmOf, longDay, minutesOf, shortWeekday, dayNumber, spokenTime, type Caller, type Resa } from "./shared";

type Table = { id: string; name: string; seats: number; room: string };
export type BookingPrefill = { day?: string; time?: string; tableId?: string };

const chip = (on: boolean) => `touch rounded-xl border px-3 text-sm font-bold transition ${on ? "border-transparent bg-brand text-white shadow-glow" : "border-line surface hover:surface-2"}`;

/**
 * Prise de réservation, pensée pour le téléphone à l'oreille : numéro d'abord (le client connu est reconnu),
 * puis nombre de personnes, jour, heure et table en un geste chacun. Une phrase récapitulative à relire au client.
 */
type Props = {
  open: boolean; onClose: () => void; editing: Resa | null; prefill: BookingPrefill | null; timezone: string;
  settings: ReservationSettings; tables: Table[]; onSaved: (day: string) => void;
  /** Réservations avancées (option Digital) : client reconnu, table, repères, e-mail de confirmation */
  advanced: boolean;
};

export function BookingModal(props: Props) {
  // Fermée : rien n'est gardé, la prochaine ouverture repart d'un formulaire neuf
  return props.open ? <BookingForm {...props} /> : null;
}

function BookingForm({ open, onClose, editing, prefill, timezone, settings, tables, onSaved, advanced }: Props) {
  const act = useAction();
  const today = localDay(new Date(), timezone);
  const blank = () => ({
    phone: "", name: "", email: "", partySize: 2, day: prefill?.day ?? today, time: prefill?.time ?? "", tableId: prefill?.tableId ?? "",
    duration: settings.duration, tags: [] as string[], allergies: "", notes: "", source: "PHONE" as ReservationSource, notify: true, customerId: null as string | null,
  });
  const [f, setF] = useState(() => editing ? {
    phone: editing.phone ?? "", name: editing.name, email: editing.email ?? "", partySize: editing.partySize, day: localDay(new Date(editing.startsAt), timezone), time: hhmmOf(editing.startsAt, timezone),
    tableId: editing.tableId ?? "", duration: editing.durationMinutes, tags: editing.tags, allergies: editing.allergies ?? "", notes: editing.notes ?? "",
    source: (editing.source as ReservationSource) ?? "PHONE", notify: false, customerId: editing.customerId as string | null,
  } : blank());
  const [moreGuests, setMoreGuests] = useState(() => !!editing && editing.partySize > 8);
  const [done, setDone] = useState<{ sentence: string; day: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [formKey, setFormKey] = useState(0); // remet le curseur sur le téléphone pour l'appel suivant

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  // Client reconnu à son numéro
  const key = phoneKey(f.phone);
  const caller = useQuery({ queryKey: ["caller", key], queryFn: () => api.get<Caller | null>(`/api/reservations/lookup?phone=${encodeURIComponent(f.phone)}`), enabled: open && advanced && key.length >= 6 && !editing });
  const known = caller.data ?? null;
  const applyCaller = (c: Caller) => setF((x) => ({ ...x, name: x.name || c.name, email: x.email || c.email || "", allergies: x.allergies || c.allergies || "", customerId: c.id }));
  // Dès que le numéro est reconnu : le nom, l'e-mail et les allergies se remplissent (sans écraser une saisie)
  const [recognized, setRecognized] = useState<string | null>(null);
  if (known && recognized !== known.id) { setRecognized(known.id); if (!f.name) applyCaller(known); }

  // Réservations du jour choisi : couverts par créneau et tables déjà prises
  const dayQ = useQuery({ queryKey: ["reservations", f.day], queryFn: () => api.get<Resa[]>(`/api/reservations?day=${f.day}`), enabled: open });
  const dayList = useMemo(() => (dayQ.data ?? []).filter((r) => counts(r) && r.status !== "COMPLETED" && r.id !== editing?.id), [dayQ.data, editing?.id]);
  const coversAt = (service: { from: string; to: string }) => dayList.filter((r) => { const m = minutesOf(hhmmOf(r.startsAt, timezone)); return m >= minutesOf(service.from) - 60 && m <= minutesOf(service.to) + 60; }).reduce((a, r) => a + r.partySize, 0);
  const slotCovers = (t: string) => dayList.filter((r) => hhmmOf(r.startsAt, timezone) === t).reduce((a, r) => a + r.partySize, 0);
  const busyTables = useMemo(() => {
    if (!f.time) return new Map<string, Resa>();
    const start = minutesOf(f.time), end = start + f.duration;
    const m = new Map<string, Resa>();
    for (const r of dayList) {
      if (!r.tableId) continue;
      const s = minutesOf(hhmmOf(r.startsAt, timezone));
      if (s < end && s + r.durationMinutes > start) m.set(r.tableId, r);
    }
    return m;
  }, [dayList, f.time, f.duration, timezone]);
  // Tables proposées : libres sur le créneau, assez grandes, les plus justes d'abord
  const suggested = useMemo(() => tables.filter((t) => !busyTables.has(t.id)).sort((a, b) => (a.seats >= f.partySize ? 0 : 1) - (b.seats >= f.partySize ? 0 : 1) || a.seats - b.seats || a.name.localeCompare(b.name, "fr", { numeric: true })), [tables, busyTables, f.partySize]);
  // Une table devenue prise (autre heure, autre jour) n'est plus retenue
  const tableId = f.tableId && !busyTables.has(f.tableId) ? f.tableId : "";

  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const table = tables.find((t) => t.id === tableId);
  const dayLabel = f.day === today ? "aujourd'hui" : f.day === addDays(today, 1) ? "demain" : longDay(f.day);
  const sentence = `${f.name ? `C'est noté ${f.name.split(" ")[0]}, ` : "C'est noté, "}une table pour ${f.partySize} ${dayLabel}${f.time ? ` à ${spokenTime(f.time)}` : ""}.`;
  const ready = f.name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.day) && /^([01]\d|2[0-3]):[0-5]\d$/.test(f.time) && f.partySize > 0;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    const body = {
      name: f.name.trim(), phone: f.phone.trim() || null, email: f.email.trim() || null, startsAt: zonedInputToDate(`${f.day}T${f.time}`, timezone).toISOString(), partySize: f.partySize,
      allergies: f.allergies || null, notes: f.notes || null, source: f.source,
      ...(advanced ? { tableId: tableId || null, durationMinutes: f.duration, tags: f.tags, notify: !!f.email.trim() && f.notify } : {}),
      ...(f.customerId && !editing ? { customerId: f.customerId } : {}),
    };
    const r = await act(() => (editing ? api.patch(`/api/reservations/${editing.id}`, body) : api.post("/api/reservations", body)), { invalidate: [["reservations"], ["reservations-summary"], ["floor"], ["caller"]] });
    setBusy(false);
    if (!r) return;
    onSaved(f.day);
    if (editing) onClose();
    else setDone({ sentence, day: f.day });
  };

  const cancelResa = async () => {
    if (!editing) return;
    const r = await act(() => api.post(`/api/reservations/${editing.id}/status`, { status: "CANCELLED", notify: !!editing.email }), { success: "Réservation annulée", invalidate: [["reservations"], ["reservations-summary"], ["floor"]] });
    if (r) onClose();
  };

  if (done) {
    return (
      <Modal open={open} onClose={onClose} size="sm">
        <div className="py-4 text-center" data-testid="booking-done">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-500 text-white shadow-lift"><Check className="h-9 w-9" strokeWidth={3} /></div>
          <h2 className="mt-4 text-xl font-extrabold">Réservation enregistrée</h2>
          <p className="mt-1 text-sm text-muted">À relire au client :</p>
          <p className="mx-auto mt-3 max-w-sm rounded-2xl surface-2 px-4 py-3 text-base font-semibold leading-snug">« {done.sentence} »</p>
          <div className="mt-6 grid gap-2">
            <Button size="lg" onClick={() => { setDone(null); setF(blank()); setMoreGuests(false); setFormKey((k) => k + 1); }}><Phone className="h-5 w-5" /> Prendre une autre réservation</Button>
            <Button size="lg" variant="secondary" onClick={onClose}>Fermer</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? "Modifier la réservation" : "Nouvelle réservation"} footer={
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <p className="min-w-0 flex-1 text-sm" data-testid="booking-summary">{ready ? <><CalendarCheck className="mr-1 inline h-4 w-4 text-lagon-600" /><b>{longDay(f.day)}</b> à <b>{f.time}</b> · {f.partySize} pers.{table ? ` · table ${table.name}` : ""}</> : <span className="text-muted">Nom, jour et heure suffisent pour enregistrer.</span>}</p>
        <Button size="lg" disabled={!ready} loading={busy} onClick={save}>{editing ? "Enregistrer" : "Enregistrer la réservation"}</Button>
      </div>
    }>
      <div className="space-y-5">
        {/* 1. Qui appelle */}
        <section className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Téléphone</span>
            <div className="relative"><Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input key={formKey} autoFocus={!editing} aria-label="Téléphone" inputMode="tel" placeholder="87 00 00 00" value={f.phone} onChange={(e) => set("phone", e.target.value)} className="h-12! pl-10! text-base!" /></div>
          </label>
          <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-muted">Nom</span>
            <div className="relative"><UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><Input aria-label="Nom" placeholder="Nom du client" value={f.name} onChange={(e) => set("name", e.target.value)} className="h-12! pl-10! text-base!" /></div>
          </label>
          {known ? (
            <div className="sm:col-span-2 rounded-2xl border border-lagon-500/30 bg-lagon-500/10 p-3 text-sm" data-testid="caller-card">
              <p className="flex flex-wrap items-center gap-x-2 font-bold"><Sparkles className="h-4 w-4 text-lagon-600" />Client connu : {known.name || "sans nom"}
                <span className="font-medium text-muted">{known.visitCount ? `${known.visitCount} visite${known.visitCount > 1 ? "s" : ""}` : "première visite"}{known.lastVisit ? ` · dernière le ${new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: timezone }).format(new Date(known.lastVisit))}` : ""}</span>
                {f.customerId !== known.id ? <button className="ml-auto text-xs font-bold text-lagon-700 underline dark:text-lagon-300" onClick={() => applyCaller(known)}>Reprendre ses informations</button> : null}
              </p>
              {known.allergies ? <p className="mt-1 font-semibold text-red-600">⚠ Allergies : {known.allergies}</p> : null}
              {known.noShows ? <p className="mt-1 flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300"><TriangleAlert className="h-4 w-4" />{known.noShows} réservation{known.noShows > 1 ? "s" : ""} sans venir ni prévenir</p> : null}
              {known.upcoming.length ? <p className="mt-1 text-muted">Déjà réservé : {known.upcoming.map((u) => `${new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone }).format(new Date(u.startsAt))} (${u.partySize} pers.)`).join(" · ")}</p> : null}
              {known.notes ? <p className="mt-1 text-muted">Note : {known.notes}</p> : null}
            </div>
          ) : null}
        </section>

        {/* 2. Combien */}
        <section>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Personnes</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Personnes">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <button key={n} role="radio" aria-checked={f.partySize === n && !moreGuests} onClick={() => { setMoreGuests(false); set("partySize", n); }} className={`${chip(f.partySize === n && !moreGuests)} h-12 w-12 text-base`}>{n}</button>)}
            <button onClick={() => { setMoreGuests(true); if (f.partySize <= 8) set("partySize", 10); }} className={`${chip(moreGuests)} h-12`}>Plus…</button>
            {moreGuests ? <Input aria-label="Nombre de personnes" type="number" min={1} max={50} value={f.partySize} onChange={(e) => set("partySize", Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className="h-12! w-24!" /> : null}
          </div>
        </section>

        {/* 3. Quel jour */}
        <section>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Jour</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {days.map((d, i) => (
              <button key={d} onClick={() => set("day", d)} aria-pressed={f.day === d} className={`${chip(f.day === d)} flex h-16 min-w-[64px] shrink-0 flex-col items-center justify-center leading-tight`}>
                <span className="text-[11px] font-semibold uppercase opacity-80">{i === 0 ? "Auj." : i === 1 ? "Dem." : shortWeekday(d)}</span><span className="text-lg font-extrabold">{dayNumber(d)}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <DatePicker value={f.day} today={today} min={today} onChange={(d) => set("day", d)} label={days.includes(f.day) ? "Autre date" : longDay(f.day)} className={days.includes(f.day) ? "" : "[&>button]:border-lagon-500 [&>button]:text-lagon-700"} />
          </div>
        </section>

        {/* 4. À quelle heure */}
        <section>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Heure <span className="normal-case font-medium">· {longDay(f.day)}</span></p>
          <div className="space-y-3">
            {settings.services.filter((s) => s.enabled).map((s) => {
              const total = coversAt(s);
              const full = advanced && settings.capacity !== null && total + f.partySize > settings.capacity;
              return (
                <div key={s.key}>
                  <p className="mb-1.5 flex items-center gap-2 text-sm font-bold">{s.label}<span className="text-xs font-medium text-muted">{total} couvert{total > 1 ? "s" : ""} déjà réservé{total > 1 ? "s" : ""}{advanced && settings.capacity ? ` sur ${settings.capacity}` : ""}</span>{full ? <span className="rounded-full bg-amber-500/15 px-2 text-[11px] font-bold text-amber-700 dark:text-amber-300">complet pour {f.partySize}</span> : null}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {serviceSlots(s, settings.interval).map((t) => {
                      const c = slotCovers(t);
                      const past = f.day === today && minutesOf(t) < minutesOf(hhmmOf(new Date(), timezone)) - 15;
                      return <button key={t} onClick={() => set("time", t)} aria-pressed={f.time === t} disabled={past} className={`${chip(f.time === t)} flex h-12 min-w-[68px] flex-col items-center justify-center leading-none disabled:opacity-30 ${full && f.time !== t ? "opacity-60" : ""}`}><span>{t}</span>{c ? <span className={`mt-1 text-[10px] font-semibold ${f.time === t ? "opacity-90" : "text-muted"}`}>{c} cvts</span> : null}</button>;
                    })}
                  </div>
                </div>
              );
            })}
            <label className="flex items-center gap-2 text-sm text-muted">Autre heure <input type="time" aria-label="Autre heure" value={f.time} onChange={(e) => e.target.value && set("time", e.target.value)} className="h-10 rounded-xl border border-line surface px-2 font-bold text-[var(--text)]" /></label>
          </div>
        </section>

        {/* 5. Quelle table (réservations avancées) */}
        {advanced && tables.length ? (
          <section>
            <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">Table
              <select aria-label="Durée" value={f.duration} onChange={(e) => set("duration", Number(e.target.value))} className="ml-auto rounded-lg border border-line surface px-2 py-1 text-xs font-bold normal-case text-[var(--text)]">{[60, 90, 120, 150, 180].map((m) => <option key={m} value={m}>{m < 120 ? (m === 60 ? "1 h" : "1 h 30") : `${Math.floor(m / 60)} h${m % 60 ? " 30" : ""}`} à table</option>)}</select>
            </p>
            {!f.time ? <p className="text-sm text-muted">Choisissez l&apos;heure pour voir les tables libres.</p> : (
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => set("tableId", "")} aria-pressed={!tableId} className={`${chip(!tableId)} h-12`}>À placer plus tard</button>
                {suggested.map((t) => <button key={t.id} onClick={() => set("tableId", t.id)} aria-pressed={tableId === t.id} title={t.room} className={`${chip(tableId === t.id)} flex h-12 min-w-[64px] flex-col items-center justify-center leading-none ${t.seats < f.partySize ? "opacity-60" : ""}`}><span>{t.name}</span><span className={`mt-1 text-[10px] font-semibold ${tableId === t.id ? "opacity-90" : "text-muted"}`}>{t.seats} pl.</span></button>)}
                {busyTables.size ? <p className="w-full text-xs text-muted">Déjà réservées sur ce créneau : {[...busyTables.entries()].map(([id, r]) => `${tables.find((t) => t.id === id)?.name ?? "?"} (${r.name.split(" ")[0]} ${hhmmOf(r.startsAt, timezone)})`).join(", ")}</p> : null}
              </div>
            )}
          </section>
        ) : null}

        {/* 6. Le petit plus */}
        <section>
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">À savoir</p>
          {advanced ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {RESERVATION_TAGS.map((t) => { const on = f.tags.includes(t.key); return <button key={t.key} aria-pressed={on} onClick={() => set("tags", on ? f.tags.filter((x) => x !== t.key) : [...f.tags, t.key])} className={`${chip(on)} h-10`}>{t.emoji} {t.label}</button>; })}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Input aria-label="Allergies" placeholder="Allergies (gluten, crustacés…)" value={f.allergies} onChange={(e) => set("allergies", e.target.value)} />
            <Input aria-label="Note" placeholder="Note (fête, place préférée…)" value={f.notes} onChange={(e) => set("notes", e.target.value)} />
            {advanced ? <Input aria-label="Email" type="email" placeholder="E-mail (facultatif)" value={f.email} onChange={(e) => set("email", e.target.value)} /> : null}
            {advanced && f.email.trim() ? <div className="flex items-center"><Toggle checked={f.notify} onChange={(v) => set("notify", v)} label={editing ? "Envoyer la modification par e-mail" : "Envoyer la confirmation par e-mail"} /></div> : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm"><span className="mr-1 text-muted">Prise</span>
            {(Object.keys(RESERVATION_SOURCES) as ReservationSource[]).filter((k) => k !== "ONLINE" || f.source === "ONLINE").map((k) => <button key={k} aria-pressed={f.source === k} onClick={() => set("source", k)} className={`${chip(f.source === k)} h-9 text-xs`}>{RESERVATION_SOURCES[k].emoji} {RESERVATION_SOURCES[k].label}</button>)}
          </div>
          {!advanced ? <p className="mt-3 rounded-2xl surface-2 px-3 py-2 text-xs text-muted" data-testid="booking-upsell"><Sparkles className="mr-1 inline h-3.5 w-3.5 text-lagon-600" />Avec l&apos;option <b>Digital</b> : client reconnu à son numéro, table attribuée sans doublon, planning des tables, confirmation par e-mail et réservation en ligne sur votre site.</p> : null}
        </section>

        {editing && editing.status !== "CANCELLED" && editing.status !== "COMPLETED" ? (
          <div className="border-t border-line pt-4"><Button variant="ghost" className="text-red-600" onClick={cancelResa}>Annuler la réservation{editing.email ? " (le client est prévenu par e-mail)" : ""}</Button></div>
        ) : null}
      </div>
    </Modal>
  );
}
