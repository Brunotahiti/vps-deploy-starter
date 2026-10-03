"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellRing, CalendarDays, Check, Clock, Mail, MessageSquareWarning, Phone, Users, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { useSession } from "@/hooks/use-session";
import { useAction } from "@/components/admin/common";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/field";
import { formatElapsed, formatTime } from "@/lib/dates";

type Pending = { id: string; name: string; phone: string | null; email: string | null; startsAt: string; partySize: number; notes: string | null; allergies: string | null; createdAt: string; source: string };
const SEEN = "mr-pending-seen";

/** Petit carillon (le navigateur peut le bloquer tant que personne n'a touché l'écran : sans conséquence). */
function chime() {
  try {
    const ctx = new AudioContext(), t = ctx.currentTime;
    setTimeout(() => void ctx.close().catch(() => {}), 1500); // libéré après le son : une caisse ouverte toute la journée n'en accumule pas
    [[988, 0], [1319, 0.16], [1568, 0.32]].forEach(([f, d]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.3, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.8);
      o.connect(g).connect(ctx.destination); o.start(t + d); o.stop(t + d + 0.9);
    });
  } catch { /* son indisponible */ }
}
const readSeen = (): string[] => { try { return JSON.parse(sessionStorage.getItem(SEEN) ?? "[]"); } catch { return []; } };
const writeSeen = (ids: string[]) => { try { sessionStorage.setItem(SEEN, JSON.stringify(ids.slice(-100))); } catch { /* stockage indisponible */ } };

/**
 * Demandes de réservation en ligne à valider : grand message dès qu'une demande arrive (carillon), avec Confirmer /
 * Refuser ; le client reçoit la réponse par e-mail. « Plus tard » laisse un bandeau tant qu'il reste des demandes.
 */
export function PendingReservationsAlert() {
  const { can, hasOption, timezone } = useSession();
  const enabled = can("pos.use") && hasOption("digital");
  const q = useQuery({ queryKey: ["reservations", "pending"], queryFn: () => api.get<Pending[]>("/api/reservations/pending"), enabled, refetchInterval: 20_000 });
  const list = enabled ? (q.data ?? []) : [];
  const [manualOpen, setManualOpen] = useState(false);
  const [seenVersion, setSeenVersion] = useState(0);
  const chimed = useRef<Set<string> | null>(null);
  // « Plus tard » marque les demandes affichées comme vues dans cet onglet
  const seen = useMemo(() => { void seenVersion; return new Set(readSeen()); }, [seenVersion]);
  // Ouverture automatique pour une vraie nouveauté (reçue depuis moins de 2 h, jamais vue ici) ; les demandes plus
  // anciennes restent signalées par le bandeau, qui ouvre la liste d'un appui
  const fetchedAt = q.dataUpdatedAt; // heure du dernier chargement de la liste
  const unseen = list.filter((r) => !seen.has(r.id) && fetchedAt - new Date(r.createdAt).getTime() < 2 * 3600_000);
  const open = manualOpen || unseen.length > 0;
  // Carillon à l'arrivée d'une nouvelle demande (pas au premier chargement de la page)
  const ids = list.map((r) => r.id).join(",");
  useEffect(() => {
    if (!q.data) return;
    if (chimed.current && q.data.some((r) => !chimed.current!.has(r.id))) chime();
    chimed.current = new Set(q.data.map((r) => r.id));
  }, [ids, q.data]);
  const later = () => { writeSeen([...readSeen(), ...list.map((r) => r.id)]); setSeenVersion((v) => v + 1); setManualOpen(false); };

  if (!list.length) return null;
  return (
    <>
      <button onClick={() => setManualOpen(true)} className="no-print flex w-full shrink-0 items-center justify-center gap-2 bg-amber-500 px-3 py-2 text-sm font-extrabold text-white shadow-lift hover:bg-amber-600" data-testid="pending-banner">
        <BellRing className="h-4 w-4 animate-pulse" />
        {list.length === 1 ? "1 demande de réservation en attente" : `${list.length} demandes de réservation en attente`}
        <span className="rounded-full bg-white/25 px-2.5 py-0.5 text-xs">Voir</span>
      </button>
      {open ? (
        <Modal open onClose={later} size="lg" title={list.length === 1 ? "Nouvelle demande de réservation" : `${list.length} demandes de réservation`} footer={<Button variant="secondary" size="lg" className="w-full" onClick={later} data-testid="pending-later">Plus tard</Button>}>
          <p className="mb-3 flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-800 dark:text-amber-200"><Mail className="h-4 w-4 shrink-0" />Le client reçoit votre réponse par e-mail dès que vous confirmez ou refusez.</p>
          <div className="space-y-3" data-testid="pending-list">
            {list.map((r) => <PendingCard key={r.id} r={r} timezone={timezone} />)}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function PendingCard({ r, timezone }: { r: Pending; timezone: string }) {
  const act = useAction();
  const { toast } = useToast();
  const [refusing, setRefusing] = useState(false);
  const [message, setMessage] = useState("");
  const day = new Intl.DateTimeFormat("fr-FR", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date(r.startsAt)).replace(/^./, (c) => c.toUpperCase()); // « Mardi 6 octobre »
  const invalidate = [["reservations"], ["reservations-summary"], ["floor"]];
  const [busy, setBusy] = useState(false);
  // Un seul envoi à la fois (double appui) ; « expect » : refusé si un collègue a déjà répondu entre-temps
  const answer = async (status: "CONFIRMED" | "CANCELLED") => {
    if (busy) return;
    setBusy(true);
    const res = await act(
      () => api.post<{ emailed: boolean }>(`/api/reservations/${r.id}/status`, { status, expect: "PENDING", message: status === "CANCELLED" ? message.trim() || null : null }),
      { invalidate },
    );
    setBusy(false);
    if (res) toast(`${status === "CONFIRMED" ? `Réservation de ${r.name} confirmée` : `Demande de ${r.name} refusée`}${res.emailed ? " : e-mail envoyé au client" : ""}`, "success");
  };
  return (
    <article className="rounded-2xl border-2 border-amber-400/60 bg-[var(--surface)] p-4" data-testid="pending-card">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xl font-extrabold leading-tight">{r.name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-base font-bold">
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-lagon-600" />{day}</span>
            <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-lagon-600" />{formatTime(r.startsAt, timezone)}</span>
            <span className="inline-flex items-center gap-1.5"><Users className="h-4 w-4 text-lagon-600" />{r.partySize} pers.</span>
          </p>
          <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {r.phone ? <a href={`tel:${r.phone.replace(/[^+\d]/g, "")}`} className="inline-flex items-center gap-1 font-semibold text-[var(--text)]"><Phone className="h-3.5 w-3.5" />{r.phone}</a> : null}
            {r.email ? <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{r.email}</span> : null}
            <span>reçue il y a {formatElapsed(r.createdAt)}</span>
          </p>
          {r.allergies ? <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-2 py-1 text-sm font-bold text-red-700 dark:text-red-300"><MessageSquareWarning className="h-4 w-4" />Allergies : {r.allergies}</p> : null}
          {r.notes ? <p className="mt-2 whitespace-pre-line rounded-lg surface-2 px-3 py-2 text-sm">« {r.notes} »</p> : null}
        </div>
      </div>
      {refusing ? (
        <div className="mt-3 space-y-2">
          <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Message pour le client (facultatif) : complet ce soir-là, proposition d'un autre horaire…" aria-label="Message pour le client" />
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setRefusing(false)}>Retour</Button>
            <Button variant="danger" className="flex-1" loading={busy} disabled={busy} onClick={() => answer("CANCELLED")} data-testid="pending-refuse-send">Envoyer le refus</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <Button size="lg" loading={busy} disabled={busy} onClick={() => answer("CONFIRMED")} data-testid="pending-confirm"><Check className="h-5 w-5" />Confirmer</Button>
          <Button size="lg" variant="secondary" disabled={busy} onClick={() => setRefusing(true)} data-testid="pending-refuse"><X className="h-5 w-5" />Refuser</Button>
        </div>
      )}
    </article>
  );
}
