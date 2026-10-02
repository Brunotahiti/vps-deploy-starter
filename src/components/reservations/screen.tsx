"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, ChevronRight, List, Phone, Search, Settings2, GanttChart, Users, Clock3, Inbox } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { addDays, localDay } from "@/lib/dates";
import { DEFAULT_RESERVATION_SETTINGS, RESERVATION_SOURCES, RESERVATION_TAGS, serviceOfTime, type ReservationSettings, type ReservationSource } from "@/lib/reservations";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { useAction } from "@/components/admin/common";
import { useFloor } from "@/components/pos/floor";
import { BookingModal, type BookingPrefill } from "./booking-modal";
import { Planning } from "./planning";
import { ReservationSettingsModal } from "./settings-modal";
import { DatePicker } from "./date-picker";
import { STATUS, counts, dayNumber, hhmmOf, longDay, shortWeekday, type DaySummary, type Resa } from "./shared";

const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));

/** Réservations : la semaine d'un coup d'œil, le service en liste ou en planning des tables, prise rapide au téléphone. */
export function ReservationsScreen() {
  const router = useRouter();
  const { toast } = useToast();
  const { timezone, can, hasOption } = useSession();
  const advanced = hasOption("digital"); // réservations avancées : planning des tables, client reconnu, réglages
  const act = useAction();
  const today = localDay(new Date(), timezone);
  const [day, setDay] = useState(today);
  const [view, setView] = useState<"list" | "planning">("list");
  const [service, setService] = useState<"lunch" | "dinner">(() => (Number(hhmmOf(new Date(), timezone).slice(0, 2)) >= 15 ? "dinner" : "lunch"));
  const [search, setSearch] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [booking, setBooking] = useState<{ editing: Resa | null; prefill: BookingPrefill | null } | null>(null);
  const [seat, setSeat] = useState<Resa | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const q = useQuery({ queryKey: ["reservations", day], queryFn: () => api.get<Resa[]>(`/api/reservations?day=${day}`), refetchInterval: 30_000 });
  const week = mondayOf(day);
  const summary = useQuery({ queryKey: ["reservations-summary", week], queryFn: () => api.get<DaySummary[]>(`/api/reservations/summary?from=${week}&days=7`), refetchInterval: 60_000 });
  const settingsQ = useQuery({ queryKey: ["reservation-settings"], queryFn: () => api.get<ReservationSettings>("/api/reservations/settings"), staleTime: 300_000 });
  const settings = settingsQ.data ?? DEFAULT_RESERVATION_SETTINGS;
  const floor = useFloor();
  const tables = useMemo(() => (floor.data?.rooms ?? []).flatMap((r) => r.tables.map((t) => ({ id: t.id, name: t.name, seats: t.seats, room: r.name, busy: !!t.order }))), [floor.data]);

  const list = q.data ?? [];
  const active = list.filter(counts);
  const closed = list.filter((r) => !counts(r));
  const pending = active.filter((r) => r.status === "PENDING");
  const covers = (rs: Resa[]) => rs.reduce((a, r) => a + r.partySize, 0);
  const svcOf = (r: Resa) => serviceOfTime(hhmmOf(r.startsAt, timezone));
  const needle = search.trim().toLowerCase();
  const match = (r: Resa) => !needle || r.name.toLowerCase().includes(needle) || (r.phone ?? "").replace(/\s/g, "").includes(needle.replace(/\s/g, ""));
  const maxCovers = Math.max(settings.capacity ? settings.capacity * settings.services.filter((s) => s.enabled).length : 0, ...(summary.data ?? []).map((d) => d.covers), 1);

  const setStatus = async (r: Resa, status: string, tableId?: string | null) => {
    const res = await act(() => api.post<{ orderId: string | null }>(`/api/reservations/${r.id}/status`, { status, tableId }), { invalidate: [["reservations"], ["reservations-summary"], ["floor"], ["orders"]] });
    setSeat(null);
    if (res?.orderId) { toast(`Table ouverte pour ${r.name}`, "success"); router.push(`/pos/order/${res.orderId}`); }
  };
  const openNew = (prefill: BookingPrefill = {}) => setBooking({ editing: null, prefill: { day, ...prefill } });
  const svcRange = settings.services.find((s) => s.key === service) ?? DEFAULT_RESERVATION_SETTINGS.services[service === "lunch" ? 0 : 1];

  return (
    <div className="mx-auto w-full max-w-6xl overflow-y-auto p-3 sm:p-5" data-testid="reservations-screen">
      {/* En-tête */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 flex-1 text-2xl font-extrabold tracking-tight">Réservations</h1>
        {advanced && can("settings.manage") ? <Button variant="secondary" onClick={() => setSettingsOpen(true)} aria-label="Réglages des réservations"><Settings2 className="h-4 w-4" /><span className="hidden sm:inline">Réglages</span></Button> : null}
        <Button size="lg" onClick={() => openNew()} data-testid="new-reservation"><Phone className="h-5 w-5" /> Nouvelle réservation</Button>
      </div>

      {/* Jour affiché : flèches, retour à aujourd'hui, calendrier du mois */}
      <div className="card relative z-30 mb-3 flex flex-wrap items-center gap-2 p-2">
        <button onClick={() => setDay(addDays(day, -1))} className="touch flex h-11 w-11 items-center justify-center rounded-xl surface-2" aria-label="Jour précédent"><ChevronLeft className="h-5 w-5" /></button>
        <div className="min-w-0 flex-1 text-center sm:flex-none sm:px-3 sm:text-left">
          <p className="text-[11px] font-bold uppercase tracking-wide text-brand">{day === today ? "Aujourd'hui" : day === addDays(today, 1) ? "Demain" : day === addDays(today, -1) ? "Hier" : day < today ? "Jour passé" : "À venir"}</p>
          <p className="truncate text-lg font-extrabold capitalize leading-tight" data-testid="reservations-day">{longDay(day)}</p>
        </div>
        <button onClick={() => setDay(addDays(day, 1))} className="touch flex h-11 w-11 items-center justify-center rounded-xl surface-2" aria-label="Jour suivant"><ChevronRight className="h-5 w-5" /></button>
        <div className="flex w-full gap-2 sm:ml-auto sm:w-auto">
          {day !== today ? <Button variant="secondary" className="flex-1 sm:flex-none" onClick={() => setDay(today)}>Aujourd&apos;hui</Button> : null}
          <DatePicker value={day} today={today} onChange={setDay} className="flex-1 sm:flex-none [&>button]:w-full" />
        </div>
      </div>

      {/* Semaine */}
      <div className="mb-4 flex items-stretch gap-1.5">
        <button onClick={() => setDay(addDays(day, -7))} className="touch flex w-9 shrink-0 items-center justify-center rounded-xl surface-2" aria-label="Semaine précédente"><ChevronLeft className="h-5 w-5" /></button>
        <div className="grid min-w-0 flex-1 grid-cols-7 gap-1.5" data-testid="week-strip">
          {Array.from({ length: 7 }, (_, i) => addDays(week, i)).map((d) => {
            const s = summary.data?.find((x) => x.day === d);
            const sel = d === day;
            return (
              <button key={d} onClick={() => setDay(d)} aria-pressed={sel} className={`touch relative flex flex-col items-center rounded-2xl px-1 py-2 transition ${sel ? "bg-brand text-white shadow-glow" : "card hover:surface-2"} ${d < today && !sel ? "opacity-60" : ""}`}>
                <span className={`text-[11px] font-bold uppercase ${sel ? "opacity-90" : "text-muted"}`}>{d === today ? "Auj." : shortWeekday(d)}</span>
                <span className="text-lg font-extrabold leading-tight">{dayNumber(d)}</span>
                <span className={`text-[10px] font-semibold ${sel ? "opacity-90" : "text-muted"}`}>{s?.covers ? `${s.covers} cvts` : "—"}</span>
                <span className={`mt-1 h-1 w-3/4 overflow-hidden rounded-full ${sel ? "bg-white/30" : "surface-3"}`}><span className={`block h-full rounded-full ${sel ? "bg-white" : "bg-lagon-500"}`} style={{ width: `${Math.min(100, ((s?.covers ?? 0) / maxCovers) * 100)}%` }} /></span>
                {s?.pending ? <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-[var(--surface)]" title={`${s.pending} à confirmer`} /> : null}
              </button>
            );
          })}
        </div>
        <button onClick={() => setDay(addDays(day, 7))} className="touch flex w-9 shrink-0 items-center justify-center rounded-xl surface-2" aria-label="Semaine suivante"><ChevronRight className="h-5 w-5" /></button>
      </div>

      {/* Chiffres du jour */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi icon={<CalendarDays className="h-4 w-4" />} label="Réservations" value={active.length} />
        <Kpi icon={<Users className="h-4 w-4" />} label="Couverts" value={covers(active)} hint={settings.services.filter((s) => s.enabled).map((s) => `${s.label} ${covers(active.filter((r) => svcOf(r) === s.key))}`).join(" · ")} />
        <Kpi icon={<Inbox className="h-4 w-4" />} label="À confirmer" value={pending.length} tone={pending.length ? "amber" : undefined} />
        <Kpi icon={<Clock3 className="h-4 w-4" />} label="Arrivés / installés" value={active.filter((r) => r.status === "ARRIVED" || r.status === "SEATED" || r.status === "COMPLETED").length} />
      </div>

      {/* Vue */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-xl surface-2 p-1" role="tablist">
          <button role="tab" aria-selected={view === "list"} onClick={() => setView("list")} className={`touch flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-bold ${view === "list" ? "surface shadow-sm" : "text-muted"}`}><List className="h-4 w-4" />Liste</button>
          {advanced ? <button role="tab" aria-selected={view === "planning"} onClick={() => setView("planning")} className={`touch flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-bold ${view === "planning" ? "surface shadow-sm" : "text-muted"}`}><GanttChart className="h-4 w-4" />Planning des tables</button> : null}
        </div>
        {advanced && view === "planning" ? (
          <div className="flex rounded-xl surface-2 p-1">
            {settings.services.filter((s) => s.enabled).map((s) => <button key={s.key} aria-pressed={service === s.key} onClick={() => setService(s.key)} className={`touch h-9 rounded-lg px-3 text-sm font-bold ${service === s.key ? "surface shadow-sm" : "text-muted"}`}>{s.label}</button>)}
          </div>
        ) : (
          <label className="relative ml-auto w-full sm:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" /><input aria-label="Rechercher une réservation" placeholder="Nom ou téléphone" value={search} onChange={(e) => setSearch(e.target.value)} className="h-11 w-full rounded-xl border border-line surface pl-9 pr-3 text-sm outline-none focus:border-lagon-500" /></label>
        )}
      </div>

      {q.isLoading ? <div className="flex justify-center py-10"><Spinner /></div> : null}

      {!q.isLoading && advanced && view === "planning" ? (
        tables.length ? <Planning list={list} tables={tables} range={svcRange} interval={settings.interval} timezone={timezone} isToday={day === today} onOpen={(r) => setBooking({ editing: r, prefill: null })} onNew={(p) => openNew(p)} />
          : <p className="card p-6 text-center text-sm text-muted">Aucune table : dessinez votre salle dans Gestion → Plan de salle pour voir le planning.</p>
      ) : null}

      {!q.isLoading && (view === "list" || !advanced) ? (
        <div className="space-y-5">
          {pending.length ? (
            <section className="rounded-3xl border border-amber-500/30 bg-amber-500/5 p-3" data-testid="pending-requests">
              <h2 className="mb-2 flex items-center gap-2 px-1 text-sm font-extrabold text-amber-700 dark:text-amber-300"><Inbox className="h-4 w-4" />{pending.length} demande{pending.length > 1 ? "s" : ""} à confirmer</h2>
              <div className="space-y-2">{pending.filter(match).map((r) => <Card key={r.id} r={r} />)}</div>
            </section>
          ) : null}
          {settings.services.map((s) => {
            const rs = active.filter((r) => r.status !== "PENDING" && svcOf(r) === s.key && match(r));
            if (!rs.length) return null;
            return (
              <section key={s.key}>
                <h2 className="mb-2 flex items-baseline gap-2 px-1"><span className="text-lg font-extrabold">{s.label}</span><span className="text-sm text-muted">{rs.length} réservation{rs.length > 1 ? "s" : ""} · {covers(rs)} couvert{covers(rs) > 1 ? "s" : ""}</span></h2>
                <div className="space-y-2">{rs.map((r) => <Card key={r.id} r={r} />)}</div>
              </section>
            );
          })}
          {!active.length ? (
            <div className="card flex flex-col items-center px-6 py-12 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-lagon-500/10 text-lagon-600"><CalendarDays className="h-8 w-8" /></span>
              <p className="mt-3 text-lg font-extrabold">Aucune réservation {day === today ? "aujourd'hui" : `le ${longDay(day)}`}</p>
              <p className="mt-1 text-sm text-muted">Le téléphone sonne ? Tout se prend en quelques gestes.</p>
              <Button className="mt-4" size="lg" onClick={() => openNew()}><Phone className="h-5 w-5" /> Prendre une réservation</Button>
            </div>
          ) : null}
          {closed.length ? (
            <section>
              <button onClick={() => setShowClosed(!showClosed)} className="px-1 text-sm font-bold text-muted underline">{showClosed ? "Masquer" : "Voir"} les annulations et absences ({closed.length})</button>
              {showClosed ? <div className="mt-2 space-y-2 opacity-80">{closed.filter(match).map((r) => <Card key={r.id} r={r} />)}</div> : null}
            </section>
          ) : null}
        </div>
      ) : null}

      <BookingModal open={!!booking} onClose={() => setBooking(null)} editing={booking?.editing ?? null} prefill={booking?.prefill ?? null} timezone={timezone} settings={settings} tables={tables} onSaved={(d) => setDay(d)} advanced={advanced} />
      <ReservationSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={settings} />
      <Modal open={!!seat} onClose={() => setSeat(null)} title={seat ? `Installer ${seat.name} · ${seat.partySize} pers.` : ""} size="lg">
        <p className="mb-3 text-sm text-muted">Choisissez la table : la commande s&apos;ouvre avec {seat?.partySize} couvert{(seat?.partySize ?? 0) > 1 ? "s" : ""}, le client rattaché{seat?.allergies ? " et ses allergies notées" : ""}.</p>
        {(floor.data?.rooms ?? []).map((room) => (
          <div key={room.id} className="mb-3"><p className="mb-1 text-xs font-bold uppercase text-muted">{room.name}</p>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">{room.tables.map((t) => <button key={t.id} disabled={!!t.order} onClick={() => seat && setStatus(seat, "SEATED", t.id)} className={`touch h-16 rounded-xl text-sm font-bold disabled:opacity-30 ${seat?.tableId === t.id ? "bg-brand text-white shadow-glow" : "surface-2"}`}>{t.name}<br /><span className="text-xs font-normal opacity-80">{t.order ? "occupée" : `${t.seats} pl.`}</span></button>)}</div>
          </div>
        ))}
      </Modal>
    </div>
  );

  function Card({ r }: { r: Resa }) {
    const st = STATUS[r.status];
    const tags = RESERVATION_TAGS.filter((t) => r.tags.includes(t.key));
    const src = RESERVATION_SOURCES[(r.source as ReservationSource) ?? "PHONE"] ?? RESERVATION_SOURCES.OTHER;
    return (
      <div className="card flex flex-wrap items-stretch overflow-hidden sm:flex-nowrap" data-testid="reservation-card">
        <div className="flex w-20 shrink-0 flex-col items-center justify-center border-l-[6px] py-3" style={{ borderColor: st.dot }}>
          <span className="text-xl font-extrabold tabular-nums">{hhmmOf(r.startsAt, timezone)}</span>
          <span className={`mt-0.5 rounded-full px-1.5 text-[10px] font-bold ${st.soft} ${st.text}`}>{st.label}</span>
        </div>
        <button onClick={() => setBooking({ editing: r, prefill: null })} className="min-w-0 flex-1 px-3 py-2.5 text-left hover:surface-2" aria-label={`Modifier la réservation de ${r.name}`}>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-base font-extrabold">{r.name}</span>
            <span className="inline-flex items-center gap-1 rounded-full surface-2 px-2 py-0.5 text-xs font-extrabold"><Users className="h-3 w-3" />{r.partySize}</span>
            {r.table ? <span className="rounded-full bg-lagon-500/15 px-2 py-0.5 text-xs font-bold text-lagon-700 dark:text-lagon-300">Table {r.table.name}</span> : counts(r) ? <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-300">À placer</span> : null}
            {r.customer && r.customer.visitCount > 0 ? <span className="text-xs font-bold text-lagon-700 dark:text-lagon-300">⭐ {r.customer.visitCount} visite{r.customer.visitCount > 1 ? "s" : ""}</span> : null}
            {tags.map((t) => <span key={t.key} title={t.label} className="text-sm">{t.emoji}</span>)}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            <span title={src.label}>{src.emoji}</span> {r.phone ?? "sans téléphone"}
            {r.allergies ? <span className="ml-2 font-bold text-red-600">⚠ {r.allergies}</span> : null}
            {r.notes ? <span className="ml-2">· {r.notes}</span> : null}
            {r.createdByName ? <span className="ml-2 opacity-70">· prise par {r.createdByName}</span> : null}
          </p>
        </button>
        <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1.5 border-t border-line p-2 sm:w-auto sm:border-l sm:border-t-0">
          {r.status === "PENDING" ? <><Button size="sm" onClick={() => setStatus(r, "CONFIRMED")}>Confirmer</Button><Button size="sm" variant="ghost" onClick={() => setStatus(r, "CANCELLED")}>Refuser</Button></> : null}
          {r.status === "CONFIRMED" ? <><Button size="sm" variant="secondary" onClick={() => setStatus(r, "ARRIVED")}>Arrivés</Button><Button size="sm" onClick={() => setSeat(r)}>Installer</Button><Button size="sm" variant="ghost" onClick={() => setStatus(r, "NO_SHOW")} title="Le client n'est pas venu">Absent</Button></> : null}
          {r.status === "ARRIVED" ? <Button size="sm" onClick={() => setSeat(r)}>Installer</Button> : null}
          {r.status === "SEATED" ? <Button size="sm" variant="secondary" onClick={() => setStatus(r, "COMPLETED")}>Terminée</Button> : null}
          {r.status === "CANCELLED" || r.status === "NO_SHOW" ? <Button size="sm" variant="ghost" onClick={() => setStatus(r, "CONFIRMED")}>Rétablir</Button> : null}
        </div>
      </div>
    );
  }
}

function Kpi({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: number; hint?: string; tone?: "amber" }) {
  return (
    <div className={`card px-3 py-2.5 ${tone === "amber" ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
      <p className={`flex items-center gap-1.5 text-xs font-bold ${tone === "amber" ? "text-amber-700 dark:text-amber-300" : "text-muted"}`}>{icon}{label}</p>
      <p className="text-2xl font-extrabold tabular-nums">{value}</p>
      {hint ? <p className="truncate text-[11px] text-muted">{hint}</p> : null}
    </div>
  );
}
