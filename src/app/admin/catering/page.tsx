"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ChefHat, Lock, MapPin, PartyPopper, Plus, Users } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { PageHeader } from "@/components/admin/common";
import { Button } from "@/components/ui/button";
import { Badge, Empty, Spinner } from "@/components/ui/misc";
import { Money } from "@/components/money";
import { EventForm, type EventSummary } from "@/components/admin/catering";
import { EVENT_KINDS, EVENT_STATUS } from "@/lib/catering";
import { addDays, formatTime, localDay } from "@/lib/dates";

const DOT: Record<EventSummary["status"], string> = { DRAFT: "bg-slate-400", SENT: "bg-orange-500", ACCEPTED: "bg-green-600", INVOICED: "bg-blue-600", CANCELLED: "bg-red-400" };
const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const monthLabel = (m: string) => new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${m}-01T12:00:00Z`));
const lastDay = (m: string) => { const [y, mo] = m.split("-").map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`; };
const shiftMonth = (m: string, n: number) => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const longDay = (d: string) => new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

/** Traiteur & événements (option) : planning du mois et prochains événements ; sans le droit de gérer, sans les montants. */
export default function CateringPage() {
  const { can, hasOption, timezone } = useSession();
  const allowed = hasOption("catering") && (can("catering.view") || can("catering.manage"));
  const manage = can("catering.manage");
  const today = localDay(new Date(), timezone);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [creating, setCreating] = useState(false);
  const from = `${month}-01`, to = lastDay(month);
  const monthQ = useQuery({ queryKey: ["catering", "month", month], queryFn: () => api.get<EventSummary[]>(`/api/catering?from=${from}&to=${to}`), enabled: allowed });
  const nextQ = useQuery({ queryKey: ["catering", "upcoming"], queryFn: () => api.get<EventSummary[]>("/api/catering"), enabled: allowed });
  if (!allowed) return <Empty title="Traiteur & événements" hint="Cette option se débloque dans Gestion → Options." />;

  const upcoming = (nextQ.data ?? []).filter((e) => e.status !== "CANCELLED");
  const dayOf = (e: EventSummary) => localDay(new Date(e.startsAt), timezone);
  // Grille du mois : lundi de la première semaine → dimanche de la dernière
  const firstDow = (new Date(`${from}T12:00:00Z`).getUTCDay() + 6) % 7;
  const gridStart = addDays(from, -firstDow);
  const weeks = Math.ceil((firstDow + Number(to.slice(8))) / 7);
  const href = (e: EventSummary) => (manage ? `/admin/catering/${e.id}` : `/api/catering/${e.id}/kitchen`);
  const kpi = manage ? {
    pending: upcoming.filter((e) => e.status === "SENT").length,
    confirmed: upcoming.filter((e) => e.status === "ACCEPTED" || e.status === "INVOICED"),
    deposits: upcoming.filter((e) => e.status === "ACCEPTED").reduce((s, e) => s + Math.max(0, (e.depositAmount ?? 0) - (e.paid ?? 0)), 0),
    toCollect: upcoming.filter((e) => e.status === "ACCEPTED" || e.status === "INVOICED").reduce((s, e) => s + Math.max(0, (e.totalTtc ?? 0) - (e.paid ?? 0)), 0),
  } : null;

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Traiteur & événements" subtitle="Buffets, mariages, privatisations et repas d'entreprise : devis, acomptes, factures et planning."
        action={manage ? <Button onClick={() => setCreating(true)} data-testid="event-new"><Plus className="h-4 w-4" />Nouvel événement</Button> : undefined} />

      {kpi ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div className="card p-4"><p className="text-xs uppercase text-muted">Confirmés à venir</p><p className="text-2xl font-extrabold">{kpi.confirmed.length}</p><p className="text-xs text-muted">{kpi.confirmed.reduce((s, e) => s + e.guests, 0)} personnes</p></div>
          <div className="card p-4"><p className="text-xs uppercase text-muted">Devis en attente</p><p className="text-2xl font-extrabold">{kpi.pending}</p></div>
          <div className={`card p-4 ${kpi.deposits ? "ring-2 ring-orange-400/50" : ""}`}><p className="text-xs uppercase text-muted">Acomptes à recevoir</p><p className="text-2xl font-extrabold"><Money amount={kpi.deposits} /></p></div>
          <div className="card p-4"><p className="text-xs uppercase text-muted">Reste à encaisser</p><p className="text-2xl font-extrabold"><Money amount={kpi.toCollect} /></p></div>
        </div>
      ) : null}

      {/* Planning du mois */}
      <section className="card mb-6 p-3 sm:p-4" data-testid="catering-calendar">
        <div className="mb-3 flex items-center gap-2">
          <button onClick={() => setMonth(shiftMonth(month, -1))} className="touch flex h-10 w-10 items-center justify-center rounded-xl surface-2" aria-label="Mois précédent"><ChevronLeft className="h-5 w-5" /></button>
          <h2 className="flex-1 text-center text-lg font-extrabold capitalize">{monthLabel(month)}</h2>
          {month !== today.slice(0, 7) ? <Button size="sm" variant="secondary" onClick={() => setMonth(today.slice(0, 7))}>Ce mois-ci</Button> : null}
          <button onClick={() => setMonth(shiftMonth(month, 1))} className="touch flex h-10 w-10 items-center justify-center rounded-xl surface-2" aria-label="Mois suivant"><ChevronRight className="h-5 w-5" /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-muted">{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i)).map((d) => {
            const evs = (monthQ.data ?? []).filter((e) => dayOf(e) === d);
            const out = d.slice(0, 7) !== month;
            return (
              <div key={d} className={`min-h-[64px] rounded-xl p-1 text-left sm:min-h-[92px] sm:p-1.5 ${out ? "opacity-35" : "surface-2"} ${d === today ? "ring-2 ring-lagon-500" : ""}`}>
                <p className={`text-xs font-bold ${d === today ? "text-brand" : ""}`}>{Number(d.slice(8))}</p>
                <div className="mt-0.5 space-y-0.5">
                  {evs.map((e) => (
                    <Link key={e.id} href={href(e)} target={manage ? undefined : "_blank"} title={`${e.title} · ${formatTime(e.startsAt, timezone)} · ${e.guests} pers.`} data-testid="calendar-event"
                      className={`flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px] font-semibold leading-tight hover:brightness-95 ${e.status === "CANCELLED" ? "line-through opacity-60" : ""} bg-[var(--surface)]`}>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[e.status]}`} />
                      <span className="hidden truncate sm:inline">{formatTime(e.startsAt, timezone)} {e.title}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted">{Object.entries(EVENT_STATUS).map(([k, s]) => <span key={k} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${DOT[k as EventSummary["status"]]}`} />{s.label}</span>)}</div>
      </section>

      {/* Prochains événements */}
      <h2 className="mb-2 text-base font-extrabold">Prochains événements</h2>
      {nextQ.isLoading ? <Spinner /> : !upcoming.length ? (
        <Empty title="Aucun événement à venir" hint={manage ? "Créez un événement, composez le devis avec les plats de votre carte et envoyez-le au client." : "Les événements confirmés apparaîtront ici."} action={manage ? <Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" />Nouvel événement</Button> : undefined} />
      ) : (
        <ul className="card divide-y divide-[var(--border)]">
          {upcoming.map((e) => {
            const d = dayOf(e);
            return (
              <li key={e.id}>
                <Link href={href(e)} target={manage ? undefined : "_blank"} className="flex items-center gap-3 px-4 py-3 hover:surface-2" data-testid="event-row">
                  <span className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-rose-600 text-white shadow-lift">
                    <span className="text-[10px] font-bold uppercase leading-none">{longDay(d).split(" ")[0]}</span>
                    <span className="text-xl font-extrabold leading-tight">{Number(d.slice(8))}</span>
                    <span className="text-[10px] font-bold uppercase leading-none">{new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`))}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{e.title} <span className="ml-1"><Badge color={EVENT_STATUS[e.status].color}>{EVENT_STATUS[e.status].label}</Badge></span></p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
                      <span>{EVENT_KINDS[e.kind]} · {formatTime(e.startsAt, timezone)} – {formatTime(e.endsAt, timezone)}</span>
                      <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{e.guests}</span>
                      <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{e.location ?? "Au restaurant"}</span>
                      {e.privatize ? <span className="inline-flex items-center gap-1 font-semibold text-violet-700 dark:text-violet-300"><Lock className="h-3 w-3" />Privatisé</span> : null}
                      {e.clientName ? <span>{e.clientCompany || e.clientName}</span> : null}
                    </p>
                  </div>
                  {manage && e.totalTtc !== undefined ? (
                    <div className="text-right text-sm">
                      <p className="font-extrabold"><Money amount={e.totalTtc} /></p>
                      {e.status === "ACCEPTED" && (e.depositAmount ?? 0) > (e.paid ?? 0) ? <p className="text-xs font-bold text-orange-600">acompte attendu</p> : e.paid ? <p className="text-xs text-muted">reçu <Money amount={e.paid} /></p> : null}
                    </div>
                  ) : <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted"><ChefHat className="h-4 w-4" />Fiche cuisine</span>}
                  {manage ? <ChevronRight className="h-4 w-4 shrink-0 text-muted" /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {creating ? <EventForm onClose={() => setCreating(false)} /> : null}
      <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted"><PartyPopper className="h-3.5 w-3.5" />Un événement privatisé et confirmé ferme les réservations en ligne sur son créneau.</p>
    </div>
  );
}
